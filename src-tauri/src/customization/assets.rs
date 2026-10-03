//! Bounded image input, real alpha validation, and consistent foot alignment.
use super::Asset;
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, GenericImageView, ImageDecoder, ImageFormat, ImageReader, RgbaImage};
use std::io::Cursor;

pub const MAX_INPUT: usize = 10 * 1024 * 1024;
pub const MAX_TOTAL: usize = 30 * 1024 * 1024;
pub const COLORS_VERSION: u8 = 2;
pub const WIDTH: u32 = 768;
pub const HEIGHT: u32 = 960;

fn decode(bytes: &[u8], generated: bool) -> Result<DynamicImage, String> {
    let format =
        image::guess_format(bytes).map_err(|_| "图片格式无法识别，请使用 PNG、JPEG 或 WebP")?;
    if (generated && format != ImageFormat::Png)
        || !matches!(
            format,
            ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
        )
    {
        return Err("图片格式不兼容；生成服务必须返回透明 PNG".into());
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(160 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| "图片无法解码或超过尺寸限制")?;
    let (w, h) = decoder.dimensions();
    if w < 32 || h < 32 || u64::from(w) * u64::from(h) > 24_000_000 {
        return Err("图片应至少 32×32 像素，且不超过 2400 万像素".into());
    }
    let orientation = decoder.orientation().map_err(|_| "无法读取图片方向")?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| "图片内容已损坏")?;
    image.apply_orientation(orientation);
    Ok(image)
}
fn png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    image
        .write_to(&mut out, ImageFormat::Png)
        .map_err(|_| "无法编码图片")?;
    Ok(out.into_inner())
}

pub fn import(encoded: &[String]) -> Result<Vec<Vec<u8>>, String> {
    if encoded.is_empty() || encoded.len() > 4 {
        return Err("请选择 1–4 张参考图片".into());
    }
    let mut total = 0;
    let mut images = Vec::new();
    for input in encoded {
        if input.len() > MAX_INPUT.div_ceil(3) * 4 {
            return Err("每张图片不能超过 10 MiB".into());
        }
        let bytes = STANDARD.decode(input).map_err(|_| "参考图片内容无法读取")?;
        if bytes.len() > MAX_INPUT {
            return Err("每张图片不能超过 10 MiB".into());
        }
        total += bytes.len();
        if total > MAX_TOTAL {
            return Err("参考图片总量不能超过 30 MiB".into());
        }
        let mut image = decode(&bytes, false)?;
        if image.width() > 1536 || image.height() > 1536 {
            image = image.resize(1536, 1536, image::imageops::FilterType::Lanczos3);
        }
        images.push(png(&image)?);
    }
    Ok(images)
}

pub fn generated(bytes: &[u8]) -> Result<(Vec<u8>, Asset, String), String> {
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("生成图片超过 20 MiB，请调整服务输出".into());
    }
    let image = decode(bytes, true)?;
    let (w, h) = image.dimensions();
    let rgba = image.to_rgba8();
    let mut transparent = 0usize;
    let mut visible = 0usize;
    let (mut left, mut top, mut right, mut bottom) = (w, h, 0, 0);
    for (x, y, p) in rgba.enumerate_pixels() {
        if p[3] < 16 {
            transparent += 1;
        }
        if p[3] > 32 {
            visible += 1;
            left = left.min(x);
            right = right.max(x);
            top = top.min(y);
            bottom = bottom.max(y);
        }
    }
    let count = (w as usize) * (h as usize);
    if transparent < count / 20 || visible < count / 100 || left >= right || top >= bottom {
        return Err("生成图片没有有效透明背景或主体；请使用支持透明 PNG 的图片模型重做".into());
    }
    // Reject opaque edge backgrounds even if a tiny transparent hole exists.
    let edge_total = (w + h) as usize * 2;
    let edge_clear = (0..w).filter(|x| rgba.get_pixel(*x, 0)[3] < 32).count()
        + (0..w).filter(|x| rgba.get_pixel(*x, h - 1)[3] < 32).count()
        + (0..h).filter(|y| rgba.get_pixel(0, *y)[3] < 32).count()
        + (0..h).filter(|y| rgba.get_pixel(w - 1, *y)[3] < 32).count();
    if edge_clear * 100 < edge_total * 90 {
        return Err("生成主体或背景碰到画布边缘，请重做完整透明角色".into());
    }
    let subject = DynamicImage::ImageRgba8(
        image::imageops::crop_imm(&rgba, left, top, right - left + 1, bottom - top + 1).to_image(),
    );
    let fitted = subject
        .resize(672, 864, image::imageops::FilterType::Lanczos3)
        .to_rgba8();
    let mut canvas = RgbaImage::new(WIDTH, HEIGHT);
    image::imageops::overlay(
        &mut canvas,
        &fitted,
        ((WIDTH - fitted.width()) / 2).into(),
        (928 - fitted.height()).into(),
    );
    let accent = extract_accent(&fitted);
    Ok((
        png(&DynamicImage::ImageRgba8(canvas))?,
        Asset {
            width: WIDTH,
            height: HEIGHT,
            anchor_x: 384,
            anchor_y: 928,
            connector_x: Some(WIDTH / 2),
            connector_y: Some(928 - fitted.height() + (fitted.height() * 3 / 10)),
        },
        accent,
    ))
}

/// Broad silhouette changes would change the apparent scale when fitted. Reject
/// them rather than quietly shrinking a raised arm or stretching the character.
pub fn consistent_with_base(base: &[u8], derived: &[u8]) -> Result<(), String> {
    fn ratio(bytes: &[u8]) -> Result<f64, String> {
        let image = decode(bytes, true)?.to_rgba8();
        let (mut l, mut t, mut r, mut b) = (image.width(), image.height(), 0, 0);
        for (x, y, p) in image.enumerate_pixels().filter(|(_, _, p)| p[3] > 32) {
            let _ = p;
            l = l.min(x);
            t = t.min(y);
            r = r.max(x);
            b = b.max(y);
        }
        if l >= r || t >= b {
            return Err("生成图片没有可用主体".into());
        }
        Ok((r - l + 1) as f64 / (b - t + 1) as f64)
    }
    let relative = ratio(derived)? / ratio(base)?;
    if !(0.85..=1.15).contains(&relative) {
        Err("这个状态的姿态或比例与主形象差异过大，请单独重做以避免切换时跳动".into())
    } else {
        Ok(())
    }
}

fn extract_accent(image: &RgbaImage) -> String {
    let mut bins = std::collections::BTreeMap::<u16, (usize, [u64; 3])>::new();
    for p in image.pixels().step_by(5).filter(|p| p[3] > 224) {
        let key = (u16::from(p[0] / 32) << 6) | (u16::from(p[1] / 32) << 3) | u16::from(p[2] / 32);
        let item = bins.entry(key).or_default();
        item.0 += 1;
        for i in 0..3 {
            item.1[i] += u64::from(p[i]);
        }
    }
    let selected = bins.values().max_by_key(|(n, sum)| {
        let c = sum.map(|v| v / (*n as u64).max(1));
        let saturation = c.iter().max().unwrap() - c.iter().min().unwrap();
        // Color-bearing fur details matter without allowing one stray pixel to dominate.
        (*n as u64) * (32 + saturation)
    });
    selected
        .map(|(n, s)| {
            format!(
                "#{:02x}{:02x}{:02x}",
                s[0] / (*n as u64),
                s[1] / (*n as u64),
                s[2] / (*n as u64)
            )
        })
        .unwrap_or_else(|| "#c48a56".into())
}
/// Samples only opaque interior pixels. Color-bearing clusters are ranked before
/// neutral fur, with a minimum population so tiny alpha/raster artifacts lose.
pub fn character_colors(bytes: &[u8]) -> Result<Vec<String>, String> {
    Ok(extract_colors(&decode(bytes, true)?.to_rgba8()))
}
fn extract_colors(image: &RgbaImage) -> Vec<String> {
    let mut bins = std::collections::BTreeMap::<u16, (usize, [u64; 3])>::new();
    let mut count = 0usize;
    for (x, y, p) in image
        .enumerate_pixels()
        .filter(|(x, y, _)| (x + y * image.width()) % 7 == 0)
    {
        if p[3] < 245 || x == 0 || y == 0 || x + 1 >= image.width() || y + 1 >= image.height() {
            continue;
        }
        if [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
            .iter()
            .any(|&(a, b)| image.get_pixel(a, b)[3] < 245)
        {
            continue;
        }
        count += 1;
        let key = (u16::from(p[0] / 32) << 6) | (u16::from(p[1] / 32) << 3) | u16::from(p[2] / 32);
        let item = bins.entry(key).or_default();
        item.0 += 1;
        for i in 0..3 {
            item.1[i] += u64::from(p[i]);
        }
    }
    let mut clusters: Vec<_> = bins
        .values()
        .filter(|(n, _)| *n >= (count / 500).max(3))
        .map(|(n, s)| {
            let rgb = s.map(|v| (v / *n as u64) as u8);
            let chroma = rgb.iter().max().unwrap() - rgb.iter().min().unwrap();
            // Warm white fur is not a colorful detail. Require both absolute
            // and relative chroma, then favor chroma over population so a real
            // smaller orange patch beats the much larger beige/gray coat.
            let maximum = u64::from(*rgb.iter().max().unwrap());
            let colorful = chroma >= 35 && u64::from(chroma) * 100 >= maximum * 24;
            let score = if colorful {
                (*n as u64).isqrt() * u64::from(chroma).pow(2)
            } else {
                *n as u64
            };
            (colorful, score, rgb)
        })
        .collect();
    clusters.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    let mut selected: Vec<[u8; 3]> = vec![];
    for (_, _, rgb) in clusters {
        if selected.iter().all(|v| {
            (0..3)
                .map(|i| (i32::from(v[i]) - i32::from(rgb[i])).pow(2))
                .sum::<i32>()
                > 2500
        }) {
            selected.push(rgb);
            if selected.len() == 4 {
                break;
            }
        }
    }
    selected
        .iter()
        .map(|c| format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2]))
        .collect()
}
pub fn data_uri(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rich_colors_keep_calico_patches_ahead_of_white_gray_and_alpha_fringe() {
        // Synthetic pixel fixture, not a generated/user photo.
        let mut image = RgbaImage::from_pixel(100, 100, image::Rgba([245, 245, 245, 255]));
        for y in 5..60 {
            for x in 5..90 {
                image.put_pixel(x, y, image::Rgba([130, 130, 130, 255]));
            }
        }
        for y in 65..80 {
            for x in 10..50 {
                image.put_pixel(x, y, image::Rgba([194, 123, 61, 255]));
            }
        }
        for y in 80..95 {
            for x in 10..50 {
                image.put_pixel(x, y, image::Rgba([47, 40, 35, 255]));
            }
        }
        for y in 0..100 {
            image.put_pixel(0, y, image::Rgba([255, 0, 255, 120]));
        }
        let colors = extract_colors(&image);
        assert_eq!(colors[0], "#c27b3d");
        assert!(colors.contains(&"#2f2823".to_string()));
        assert!(!colors.contains(&"#ff00ff".to_string()));
    }
    #[test]
    fn smaller_orange_patch_beats_majority_warm_white_fur() {
        let mut image = RgbaImage::from_pixel(100, 100, image::Rgba([200, 184, 178, 255]));
        for y in 10..30 {
            for x in 10..35 {
                image.put_pixel(x, y, image::Rgba([204, 151, 109, 255]));
            }
        }
        // A tiny saturated speck must not beat an adequately populated patch.
        image.put_pixel(50, 50, image::Rgba([255, 0, 0, 255]));
        let colors = extract_colors(&image);
        assert_eq!(colors[0], "#cc976d");
        assert!(colors.contains(&"#c8b8b2".into()));
        assert!(!colors.contains(&"#ff0000".into()));
    }
    fn sample(transparent: bool) -> Vec<u8> {
        let mut image = RgbaImage::from_pixel(
            100,
            120,
            image::Rgba([240, 200, 100, if transparent { 0 } else { 255 }]),
        );
        for y in 20..100 {
            for x in 25..75 {
                image.put_pixel(x, y, image::Rgba([190, 100, 60, 255]));
            }
        }
        png(&DynamicImage::ImageRgba8(image)).unwrap()
    }
    #[test]
    fn reference_exif_rotation_is_applied_and_metadata_is_removed() {
        let image = DynamicImage::ImageRgb8(image::RgbImage::new(64, 32));
        let mut jpeg = Cursor::new(Vec::new());
        image.write_to(&mut jpeg, ImageFormat::Jpeg).unwrap();
        let jpeg = jpeg.into_inner();
        // Minimal little-endian TIFF IFD: orientation = 6 (90 degrees clockwise).
        let exif: &[u8] = &[
            b'E', b'x', b'i', b'f', 0, 0, b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0,
            0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
        ];
        let mut input = vec![0xff, 0xd8, 0xff, 0xe1];
        input.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        input.extend_from_slice(exif);
        input.extend_from_slice(&jpeg[2..]);
        let output = import(&[STANDARD.encode(input)]).unwrap();
        let decoded = image::load_from_memory(&output[0]).unwrap();
        assert_eq!(decoded.dimensions(), (32, 64));
        assert!(!output[0].windows(4).any(|part| part == b"Exif"));
    }
    #[test]
    fn large_pose_change_is_rejected_instead_of_rescaling_silently() {
        let base = sample(true);
        let mut wide = RgbaImage::new(120, 120);
        for y in 45..75 {
            for x in 10..110 {
                wide.put_pixel(x, y, image::Rgba([100, 80, 60, 255]));
            }
        }
        assert!(
            consistent_with_base(&base, &png(&DynamicImage::ImageRgba8(wide)).unwrap()).is_err()
        );
        assert!(consistent_with_base(&base, &base).is_ok());
    }
    #[test]
    fn rejects_opaque_and_bad_images() {
        assert!(generated(&sample(false)).is_err());
        assert!(generated(b"PNG fake").is_err());
        assert!(import(&[]).is_err());
        assert!(import(&["bad".into()]).is_err());
    }
    #[test]
    fn aligns_transparent_subject_and_derives_its_color() {
        let (bytes, meta, accent) = generated(&sample(true)).unwrap();
        assert_eq!((meta.width, meta.height, meta.anchor_y), (768, 960, 928));
        assert_eq!(accent, "#be643c");
        let image = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(image.get_pixel(0, 0)[3], 0);
        assert!(image.get_pixel(384, 927)[3] > 0);
        assert_eq!(image.get_pixel(384, 929)[3], 0);
    }
    #[test]
    fn validates_actual_signature_and_normalizes_reference() {
        let bytes = sample(false);
        let normalized = import(&[STANDARD.encode(bytes)]).unwrap();
        assert_eq!(normalized.len(), 1);
        assert_eq!(
            image::guess_format(&normalized[0]).unwrap(),
            ImageFormat::Png
        );
    }
}

/// Header marks keep their own proportions; they never use pet ground alignment.
pub fn badge(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("生成标志超过 20 MB".into());
    }
    let image = decode(bytes, true)?;
    let rgba = image.to_rgba8();
    let visible = rgba.pixels().filter(|pixel| pixel[3] > 32).count();
    let transparent = rgba.pixels().filter(|pixel| pixel[3] < 16).count();
    if visible < 64 || transparent < (image.width() * image.height()) as usize / 20 {
        return Err("标志缺少可见图案或透明背景，请重新生成".into());
    }
    let normalized = png(&image.resize(256, 256, image::imageops::FilterType::Lanczos3))?;
    validate_badge(&normalized)?;
    Ok(normalized)
}
pub fn validate_badge(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 512 * 1024 {
        return Err("标志图片超过限制".into());
    }
    // Normalized narrow marks can have one side below the reference minimum.
    let mut reader = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(256);
    limits.max_image_height = Some(256);
    limits.max_alloc = Some(1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| "标志图片已损坏")?;
    if image.width() == 0 || image.height() == 0 || image.width() > 256 || image.height() > 256 {
        return Err("标志图片尺寸无效".into());
    }
    let rgba = image.to_rgba8();
    if !rgba.pixels().any(|pixel| pixel[3] < 16) {
        return Err("标志图片缺少透明背景".into());
    }
    if !rgba.pixels().any(|pixel| pixel[3] > 32) {
        return Err("标志图片完全透明".into());
    }
    Ok(())
}

#[cfg(test)]
mod badge_tests {
    use super::*;
    #[test]
    fn badge_rejects_bad_or_opaque_output_and_normalizes_with_transparency() {
        assert!(badge(b"invalid").is_err());
        let mut raster = RgbaImage::from_pixel(128, 128, image::Rgba([100, 80, 70, 255]));
        let opaque = png(&DynamicImage::ImageRgba8(raster.clone())).unwrap();
        assert!(badge(&opaque).is_err());
        assert!(validate_badge(&opaque).is_err());
        for y in 0..128 {
            for x in 0..128 {
                if x < 16 || x > 110 || y < 16 || y > 110 {
                    raster.put_pixel(x, y, image::Rgba([0, 0, 0, 0]));
                }
            }
        }
        let result = badge(&png(&DynamicImage::ImageRgba8(raster)).unwrap()).unwrap();
        validate_badge(&result).unwrap();
        let normalized = image::load_from_memory(&result).unwrap();
        assert!(normalized.width() <= 256 && normalized.height() <= 256);
        assert_eq!(normalized.to_rgba8().get_pixel(0, 0)[3], 0);
        assert!(validate_badge(b"bad").is_err());
    }
}
