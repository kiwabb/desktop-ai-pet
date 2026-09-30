//! Pure desktop geometry. macOS uses global AppKit points; other platforms
//! use global physical coordinates and scale dimensions at the boundary.

pub const PET_WIDTH: f64 = 232.0;
pub const PET_HEIGHT: f64 = 340.0;
pub const CHAT_WIDTH: f64 = 720.0;
pub const CHAT_HEIGHT: f64 = 680.0;
pub const EDGE: f64 = 12.0;
// Signed backing gaps are independent of the screen-safe EDGE. The accepted
// speech silhouette reserves 44 logical pixels (28 corner + 16 paint gutter)
// toward the cat. Overlap only its transparent margins: left body stays 8px
// outside the pet rect; right body enters 4px, short of the visible lower tail.
pub const LEFT_CHAT_GAP: f64 = -36.0;
pub const RIGHT_CHAT_GAP: f64 = -48.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct CompanionLayout {
    pub pet: Rect,
    pub chat: Rect,
}
#[derive(Clone, Copy, Debug)]
pub struct DisplayArea {
    pub work: Rect,
    pub scale: f64,
}

pub fn nearest_display(pet: Rect, displays: &[DisplayArea]) -> Option<DisplayArea> {
    let x = pet.x + pet.width / 2.0;
    let y = pet.y + pet.height / 2.0;
    displays.iter().copied().min_by(|a, b| {
        let distance = |r: Rect| {
            (x - x.clamp(r.x, r.x + r.width)).powi(2) + (y - y.clamp(r.y, r.y + r.height)).powi(2)
        };
        distance(a.work).total_cmp(&distance(b.work))
    })
}

pub fn constrain(rect: Rect, work: Rect) -> Rect {
    let axis = |origin: f64, length: f64, start: f64, available: f64| {
        origin.clamp(start, (start + available - length).max(start))
    };
    Rect {
        x: axis(rect.x, rect.width, work.x, work.width),
        y: axis(rect.y, rect.height, work.y, work.height),
        ..rect
    }
}

fn safe_area(display: DisplayArea) -> Rect {
    let work = display.work;
    // Keep controls reachable even on a work area smaller than the normal inset.
    let edge = (EDGE * display.scale)
        .min(work.width / 4.)
        .min(work.height / 4.);
    Rect {
        x: work.x + edge,
        y: work.y + edge,
        width: (work.width - edge * 2.).max(1.),
        height: (work.height - edge * 2.).max(1.),
    }
}

pub fn needs_refit(chat: Rect, display: DisplayArea) -> bool {
    let safe = safe_area(display);
    chat.width > safe.width + 0.5 || chat.height > safe.height + 0.5
}

pub fn chat_is_left(pet: Rect, chat: Rect) -> bool {
    chat.x + chat.width / 2. <= pet.x + pet.width / 2.
}

/// Project the frozen cat's nose/mouth into the chat's CSS coordinate space.
/// The artwork is 1207x1303, rendered with xMidYMax meet in the pet's fixed
/// 4px top/side and 65px bottom CSS insets. All native coordinates share one
/// space; convert by the chat scale before applying those logical insets.
/// This is metadata only: keep offscreen anchors so the frontend can decide
/// whether to clamp or omit its decorative tail without moving either window.
pub fn pet_render_anchor(pet: Rect, chat: Rect, chat_scale: f64) -> Option<Point> {
    let valid_rect = |rect: Rect| {
        [rect.x, rect.y, rect.width, rect.height]
            .iter()
            .all(|value| value.is_finite())
            && rect.width > 0.
            && rect.height > 0.
    };
    if !chat_scale.is_finite() || chat_scale <= 0. || !valid_rect(pet) || !valid_rect(chat) {
        return None;
    }
    let chat_width = chat.width / chat_scale;
    let chat_height = chat.height / chat_scale;
    if !chat_width.is_finite() || !chat_height.is_finite() || chat_width <= 0. || chat_height <= 0.
    {
        return None;
    }
    let box_width = pet.width / chat_scale - 8.;
    let box_height = pet.height / chat_scale - 69.;
    if !box_width.is_finite() || !box_height.is_finite() || box_width <= 0. || box_height <= 0. {
        return None;
    }
    let raster_scale = (box_width / 1207.).min(box_height / 1303.);
    let anchor = Point {
        x: (pet.x - chat.x) / chat_scale
            + 4.
            + (box_width - 1207. * raster_scale) / 2.
            + 530. * raster_scale,
        y: (pet.y - chat.y) / chat_scale + 4. + box_height - 1303. * raster_scale
            + 390. * raster_scale,
    };
    (anchor.x.is_finite() && anchor.y.is_finite()).then_some(anchor)
}

/// Prefer the left side. Use the right when it fits, or whichever side has
/// more room if neither does. Opening chat never changes the cat's rectangle.
pub fn adjacent_chat(pet: Rect, chat: Rect, display: DisplayArea) -> Rect {
    let safe = safe_area(display);
    let left_gap = LEFT_CHAT_GAP * display.scale;
    let right_gap = RIGHT_CHAT_GAP * display.scale;
    let left = pet.x - left_gap - safe.x;
    let right = safe.x + safe.width - pet.x - pet.width - right_gap;
    let on_left = left >= chat.width || (right < chat.width && left >= right);
    constrain(
        Rect {
            x: if on_left {
                pet.x - left_gap - chat.width
            } else {
                pet.x + pet.width + right_gap
            },
            y: pet.y + pet.height - chat.height,
            ..chat
        },
        safe,
    )
}

pub fn fit_companion_on_display(pet: Rect, display: DisplayArea) -> CompanionLayout {
    let safe = safe_area(display);
    let side_space = (pet.x - LEFT_CHAT_GAP * display.scale - safe.x)
        .max(safe.x + safe.width - pet.x - pet.width - RIGHT_CHAT_GAP * display.scale);
    let preferred_width = (CHAT_WIDTH * display.scale).min(safe.width);
    // Preserve adjacency when a usable panel fits beside the cat. Very narrow
    // displays need a clamped overlap to retain readable controls.
    let width = if side_space >= 320. * display.scale {
        preferred_width.min(side_space)
    } else {
        preferred_width
    };
    let chat = Rect {
        x: 0.,
        y: 0.,
        width,
        height: (CHAT_HEIGHT * display.scale).min(safe.height),
    };
    CompanionLayout {
        pet,
        chat: adjacent_chat(pet, chat, display),
    }
}

#[cfg(test)]
pub fn fit_companion(pet: Rect, work: Rect) -> CompanionLayout {
    fit_companion_on_display(pet, DisplayArea { work, scale: 1. })
}

pub fn union(a: Rect, b: Rect) -> Rect {
    let x = a.x.min(b.x);
    let y = a.y.min(b.y);
    Rect {
        x,
        y,
        width: (a.x + a.width).max(b.x + b.width) - x,
        height: (a.y + a.height).max(b.y + b.height) - y,
    }
}

/// Keep the two independently positioned rectangles together while dragging.
/// On a smaller display an oversized pair follows the cat; drag-end refits
/// chat once, instead of pushing the cat back onto the previous display.
pub fn constrain_companion_drag(
    candidate: CompanionLayout,
    chat_visible: bool,
    display: DisplayArea,
) -> CompanionLayout {
    let pair = union(candidate.pet, candidate.chat);
    let fits = pair.width <= display.work.width && pair.height <= display.work.height;
    let group = if chat_visible && fits {
        pair
    } else {
        candidate.pet
    };
    let bounded = constrain(group, display.work);
    let dx = bounded.x - group.x;
    let dy = bounded.y - group.y;
    CompanionLayout {
        pet: Rect {
            x: candidate.pet.x + dx,
            y: candidate.pet.y + dy,
            ..candidate.pet
        },
        chat: Rect {
            x: candidate.chat.x + dx,
            y: candidate.chat.y + dy,
            ..candidate.chat
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pet(x: f64, y: f64) -> Rect {
        Rect {
            x,
            y,
            width: PET_WIDTH,
            height: PET_HEIGHT,
        }
    }
    fn work() -> Rect {
        Rect {
            x: 0.,
            y: 24.,
            width: 1440.,
            height: 820.,
        }
    }
    fn inside(rect: Rect, work: Rect) {
        assert!(rect.x >= work.x && rect.y >= work.y);
        assert!(rect.x + rect.width <= work.x + work.width + 0.001);
        assert!(rect.y + rect.height <= work.y + work.height + 0.001);
    }
    #[test]
    fn prefers_left_and_keeps_cat_stationary() {
        let original = pet(1120., 450.);
        let layout = fit_companion(original, work());
        assert_eq!(layout.pet, original);
        assert_eq!(
            layout.chat.x + layout.chat.width + LEFT_CHAT_GAP,
            original.x
        );
        assert!(chat_is_left(original, layout.chat));
        inside(layout.chat, work());
    }
    #[test]
    fn uses_right_at_left_edge_and_clamps_when_neither_side_fits() {
        let original = pet(12., 460.);
        let layout = fit_companion(original, work());
        assert_eq!(layout.chat.x, original.x + original.width + RIGHT_CHAT_GAP);
        assert!(!chat_is_left(original, layout.chat));
        let small = Rect {
            width: 640.,
            height: 460.,
            ..work()
        };
        let original = pet(204., 100.);
        let layout = fit_companion(original, small);
        assert_eq!(layout.pet, original);
        inside(layout.chat, small);
        assert_eq!(layout.chat.width, 616.);
    }
    #[test]
    fn narrows_backing_to_keep_gap_when_cat_is_near_display_center() {
        let original = pet(650., 460.);
        let layout = fit_companion(original, work());
        assert_eq!(layout.pet, original);
        assert_eq!(layout.chat.width, 674.);
        assert_eq!(
            layout.chat.x + layout.chat.width + LEFT_CHAT_GAP,
            original.x
        );
        inside(layout.chat, work());
    }
    #[test]
    fn accepted_distance_moves_only_chat_and_preserves_its_preferred_size() {
        let original = pet(1229., 507.);
        let layout = fit_companion(
            original,
            Rect {
                x: 0.,
                y: 0.,
                width: 1728.,
                height: 1117.,
            },
        );
        assert_eq!(layout.pet, original);
        assert_eq!(
            layout.chat,
            Rect {
                x: 545.,
                y: 167.,
                width: 720.,
                height: 680.
            }
        );
    }
    #[test]
    fn mirrored_spacing_preserves_fur_clearance_across_presets_and_display_scales() {
        for scale in [1., 1.25, 1.5, 2.] {
            let display = DisplayArea {
                work: Rect {
                    x: -2560. * scale,
                    y: -200. * scale,
                    width: 2560. * scale,
                    height: 1400. * scale,
                },
                scale,
            };
            for preset in [0.8, 1., 1.2] {
                for on_left in [true, false] {
                    let original = Rect {
                        x: display.work.x + if on_left { 2100. * scale } else { 40. * scale },
                        y: display.work.y + 600. * scale,
                        width: PET_WIDTH * preset * scale,
                        height: PET_HEIGHT * preset * scale,
                    };
                    let layout = fit_companion_on_display(original, display);
                    assert_eq!(layout.pet, original);
                    assert_eq!(chat_is_left(original, layout.chat), on_left);
                    assert!((layout.chat.width - CHAT_WIDTH * scale).abs() < 0.001);
                    let actual_gap = if on_left {
                        original.x - layout.chat.x - layout.chat.width
                    } else {
                        layout.chat.x - original.x - original.width
                    } / scale;
                    assert!(
                        (actual_gap
                            - if on_left {
                                LEFT_CHAT_GAP
                            } else {
                                RIGHT_CHAT_GAP
                            })
                        .abs()
                            < 0.001
                    );
                    inside(layout.chat, safe_area(display));
                    assert_eq!(
                        fit_companion_on_display(layout.pet, display).chat,
                        layout.chat
                    );

                    // The measured matte's face begins at source x214 on row390;
                    // its lower right tail reaches x1165 on row1000. Use actual
                    // fixed CSS insets, not a window-wide percentage approximation.
                    let pet_width = original.width / scale;
                    let box_width = pet_width - 8.;
                    let raster_scale =
                        (box_width / 1207.).min((original.height / scale - 69.) / 1303.);
                    let image_x = 4. + (box_width - 1207. * raster_scale) / 2.;
                    let face_left = image_x + 214. * raster_scale;
                    let fur_right = image_x + 1165. * raster_scale;
                    assert!(LEFT_CHAT_GAP + 16. + face_left > 0.);
                    assert!(pet_width + RIGHT_CHAT_GAP + 44. - fur_right > 0.);
                    assert_eq!(LEFT_CHAT_GAP + 44., 8.);
                }
            }
        }
    }
    #[test]
    fn edges_sizes_and_presets_do_not_move_cat_on_open_or_reopen() {
        for (width, height) in [
            (1920., 1040.),
            (2560., 1400.),
            (1280., 680.),
            (800., 560.),
            (640., 460.),
        ] {
            for scale in [0.8, 1., 1.2] {
                let work = Rect {
                    x: -width,
                    y: -100.,
                    width,
                    height,
                };
                for (x, y) in [
                    (-width, -100.),
                    (-PET_WIDTH * scale, height - PET_HEIGHT * scale - 100.),
                ] {
                    let pet = Rect {
                        x,
                        y,
                        width: PET_WIDTH * scale,
                        height: PET_HEIGHT * scale,
                    };
                    let a = fit_companion(pet, work);
                    let b = fit_companion(a.pet, work);
                    assert_eq!(a.pet, pet);
                    assert_eq!(a.chat, b.chat);
                    inside(a.chat, work);
                    assert!(a.chat.width <= CHAT_WIDTH && a.chat.height <= CHAT_HEIGHT);
                }
            }
        }
    }
    #[test]
    fn mixed_dpi_preserves_global_origins() {
        for scale in [1., 1.25, 1.5, 2.] {
            let display = DisplayArea {
                work: Rect {
                    x: -3024.,
                    y: -200.,
                    width: 3024.,
                    height: 1880.,
                },
                scale,
            };
            let original = Rect {
                x: -400.,
                y: 100.,
                width: PET_WIDTH * scale,
                height: PET_HEIGHT * scale,
            };
            let layout = fit_companion_on_display(original, display);
            assert_eq!(layout.pet, original);
            assert_eq!(layout.chat.width, CHAT_WIDTH * scale);
            inside(layout.chat, display.work);
        }
    }
    fn assert_shared_delta(before: CompanionLayout, after: CompanionLayout) {
        assert_eq!(before.pet.width, after.pet.width);
        assert_eq!(before.chat.width, after.chat.width);
        assert!((after.pet.x - before.pet.x - after.chat.x + before.chat.x).abs() < 0.001);
        assert!((after.pet.y - before.pet.y - after.chat.y + before.chat.y).abs() < 0.001);
    }
    #[test]
    fn independent_pair_clamps_both_rectangles_on_drag() {
        let display = DisplayArea {
            work: work(),
            scale: 1.,
        };
        for x in [-300., 1000.] {
            let original = CompanionLayout {
                pet: pet(x + 732., 500.),
                chat: Rect {
                    x,
                    y: 160.,
                    width: 720.,
                    height: 680.,
                },
            };
            let moved = constrain_companion_drag(original, true, display);
            assert_shared_delta(original, moved);
            inside(moved.pet, display.work);
            inside(moved.chat, display.work);
        }
    }
    #[test]
    fn small_display_drag_keeps_cat_on_target_until_release() {
        let display = DisplayArea {
            work: Rect {
                x: -800.,
                y: 0.,
                width: 800.,
                height: 560.,
            },
            scale: 1.,
        };
        let original = CompanionLayout {
            pet: pet(-516., 300.),
            chat: Rect {
                x: -1248.,
                y: -40.,
                width: 720.,
                height: 680.,
            },
        };
        let moved = constrain_companion_drag(original, true, display);
        assert_shared_delta(original, moved);
        inside(moved.pet, display.work);
        assert!(needs_refit(moved.chat, display));
        let finished = fit_companion_on_display(moved.pet, display);
        assert_eq!(finished.pet, moved.pet);
        inside(finished.chat, display.work);
        assert!(!needs_refit(finished.chat, display));
    }
    #[test]
    fn hidden_chat_does_not_constrain_pet() {
        let original = CompanionLayout {
            pet: pet(10., 40.),
            chat: Rect {
                x: -722.,
                y: -300.,
                width: 720.,
                height: 680.,
            },
        };
        let moved = constrain_companion_drag(
            original,
            false,
            DisplayArea {
                work: work(),
                scale: 1.,
            },
        );
        assert_eq!(moved.pet, original.pet);
        assert_eq!(moved.chat, original.chat);
    }
}

#[cfg(test)]
mod pet_anchor_tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    fn close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 0.000_001,
            "{actual} != {expected}"
        );
    }

    #[test]
    fn mouth_projection_matches_left_and_right_backings() {
        let pet = rect(1000., 340., 232., 340.);
        let left = rect(268., 0., 720., 680.);
        let right = rect(1244., 0., 720., 680.);
        let a = pet_render_anchor(pet, left, 1.).unwrap();
        let b = pet_render_anchor(pet, right, 1.).unwrap();
        // Calibrated source point (530,390), not the window or image center.
        close(a.x, 834.359_569_179_784_6);
        close(a.y, 445.561_723_280_861_66);
        close(b.x, -141.640_430_820_215_4);
        close(b.y, a.y);
        assert!(chat_is_left(pet, left));
        assert!(!chat_is_left(pet, right));
    }

    #[test]
    fn size_presets_keep_css_insets_fixed_in_logical_pixels() {
        for (preset, local_x, chat_y) in [
            (0.8, 81.985_086_992_543_5, 480.659_652_029_826),
            (1., 102.359_569_179_784_6, 445.561_723_280_861_66),
            (1.2, 122.734_051_367_025_67, 410.463_794_531_897_3),
        ] {
            let pet = rect(1000., 340., PET_WIDTH * preset, PET_HEIGHT * preset);
            let chat = rect(
                268.,
                pet.y + pet.height - CHAT_HEIGHT,
                CHAT_WIDTH,
                CHAT_HEIGHT,
            );
            let anchor = pet_render_anchor(pet, chat, 1.).unwrap();
            close(anchor.x, 732. + local_x);
            close(anchor.y, chat_y);
        }
    }

    #[test]
    fn common_physical_scale_and_negative_origins_preserve_logical_anchor() {
        for scale in [1., 1.25, 1.5, 2.] {
            let pet = rect(-640. * scale, -140. * scale, 232. * scale, 340. * scale);
            let chat = rect(-1372. * scale, -480. * scale, 720. * scale, 680. * scale);
            let anchor = pet_render_anchor(pet, chat, scale).unwrap();
            close(anchor.x, 834.359_569_179_784_6);
            close(anchor.y, 445.561_723_280_861_66);
        }
    }

    #[test]
    fn top_bottom_clamps_and_narrow_overlap_keep_the_same_world_target() {
        for (pet, work) in [
            (rect(1120., 24., 232., 340.), rect(0., 24., 1440., 820.)),
            (rect(1120., 620., 232., 340.), rect(0., 24., 1440., 820.)),
            (rect(204., 100., 232., 340.), rect(0., 24., 640., 460.)),
        ] {
            let layout = fit_companion(pet, work);
            let anchor = pet_render_anchor(pet, layout.chat, 1.).unwrap();
            close(anchor.x + layout.chat.x, pet.x + 102.359_569_179_784_6);
            close(anchor.y + layout.chat.y, pet.y + 105.561_723_280_861_64);
            assert_eq!(layout.pet, pet);
        }
        // Metadata is intentionally not clamped to the viewport. The frontend
        // owns whether an extreme overlap/offscreen target can display a tail.
        let outside =
            pet_render_anchor(rect(0., 0., 232., 340.), rect(0., 1000., 720., 680.), 1.).unwrap();
        assert!(outside.y < 0.);
    }

    #[test]
    fn height_limited_rendering_centers_horizontally_and_bottom_aligns() {
        let anchor =
            pet_render_anchor(rect(0., 0., 200., 150.), rect(0., 0., 720., 680.), 1.).unwrap();
        close(anchor.x, 95.430_928_626_247_12);
        close(anchor.y, 28.244_052_187_260_17);
    }

    #[test]
    fn invalid_rectangles_scales_and_empty_render_boxes_omit_anchor() {
        let pet = rect(0., 0., 232., 340.);
        let chat = rect(0., 0., 720., 680.);
        for scale in [0., -1., f64::NAN, f64::INFINITY] {
            assert_eq!(pet_render_anchor(pet, chat, scale), None);
        }
        for invalid in [
            rect(f64::NAN, 0., 232., 340.),
            rect(0., f64::INFINITY, 232., 340.),
            rect(0., 0., f64::INFINITY, 340.),
            rect(0., 0., 232., -1.),
            rect(0., 0., 8., 340.),
            rect(0., 0., 232., 69.),
        ] {
            assert_eq!(pet_render_anchor(invalid, chat, 1.), None);
        }
        assert_eq!(pet_render_anchor(pet, rect(0., 0., 0., 680.), 1.), None);
        assert_eq!(
            pet_render_anchor(pet, rect(f64::INFINITY, 0., 720., 680.), 1.),
            None
        );
        assert_eq!(pet_render_anchor(pet, chat, f64::MIN_POSITIVE), None);
        assert_eq!(
            pet_render_anchor(
                rect(0., 0., f64::MAX, f64::MAX),
                rect(0., 0., f64::MIN_POSITIVE, 680.),
                1e306
            ),
            None
        );
        assert_eq!(
            pet_render_anchor(
                rect(f64::MAX, 0., 232., 340.),
                rect(-f64::MAX, 0., 720., 680.),
                1.
            ),
            None
        );
    }
}
