//! Pure desktop geometry. macOS uses global AppKit points; other platforms
//! use global physical coordinates and scale dimensions at the boundary.

pub const PET_WIDTH: f64 = 232.0;
pub const PET_HEIGHT: f64 = 340.0;
pub const CHAT_WIDTH: f64 = 720.0;
pub const CHAT_HEIGHT: f64 = 680.0;
pub const EDGE: f64 = 12.0;
// Tail reach scales with the actual pet preset. Moving the backing toward the
// cat by the same amount preserves the readable body's world boundary after
// the frontend reserves its 16px paint gutter plus this reach.
const LEFT_TAIL_REACH: f64 = 44.0;
const RIGHT_TAIL_REACH: f64 = 60.0;
const PAINT_GUTTER: f64 = 16.0;
const MIN_LINKED_WIDTH: f64 = 320.0;
const MIN_VERTICAL_BODY_HEIGHT: f64 = 320.0;
const FIT_EPSILON: f64 = 0.000_001;

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

fn valid_rect(rect: Rect) -> bool {
    [rect.x, rect.y, rect.width, rect.height]
        .iter()
        .all(|value| value.is_finite())
        && rect.width > 0.
        && rect.height > 0.
}

fn tail_reach(pet: Rect, scale: f64, on_left: bool) -> f64 {
    let pet_scale = pet.width / PET_WIDTH / scale;
    if on_left {
        LEFT_TAIL_REACH * pet_scale
    } else {
        RIGHT_TAIL_REACH * pet_scale
    }
}

fn reserved_reach(pet: Rect, scale: f64, on_left: bool, chat_width: f64) -> f64 {
    let reach = tail_reach(pet, scale, on_left);
    if chat_width / scale - 2. * PAINT_GUTTER - reach >= MIN_LINKED_WIDTH - FIT_EPSILON {
        reach
    } else {
        0.
    }
}

fn adjacency_gaps(pet: Rect, scale: f64, chat_width: f64) -> (f64, f64) {
    (
        -(8. + reserved_reach(pet, scale, true, chat_width)) * scale,
        -(20. + reserved_reach(pet, scale, false, chat_width)) * scale,
    )
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

/// Tail reservation in final chat CSS pixels, including the actual pet preset
/// and side. Zero explicitly pairs an unlinked narrow backing with no extra
/// reservation; it must not be treated as missing legacy metadata. Anchor
/// validity controls decoration only, not the body's reserved world boundary.
pub fn chat_tail_reach(pet: Rect, chat: Rect, chat_scale: f64) -> Option<f64> {
    if !chat_scale.is_finite()
        || chat_scale <= 0.
        || !valid_rect(pet)
        || !valid_rect(chat)
        || !(pet.x + pet.width / 2.).is_finite()
        || !(chat.x + chat.width / 2.).is_finite()
        || !(pet.y + pet.height).is_finite()
        || !(chat.y + chat.height).is_finite()
        || !(pet.width / chat_scale).is_finite()
        || !(chat.width / chat_scale).is_finite()
        || !(chat.height / chat_scale).is_finite()
    {
        return None;
    }
    if chat.y + chat.height <= pet.y || chat.y >= pet.y + pet.height {
        return Some(0.);
    }
    let on_left = chat_is_left(pet, chat);
    let reach = tail_reach(pet, chat_scale, on_left);
    if !reach.is_finite() || reach <= 0. || !(chat.width / chat_scale).is_finite() {
        return None;
    }
    Some(reserved_reach(pet, chat_scale, on_left, chat.width))
}

/// Project the frozen cat's nose/mouth into the chat's CSS coordinate space.
/// The artwork is 1207x1303, rendered with xMidYMax meet in the pet's fixed
/// 4px top/side and 65px bottom CSS insets. All native coordinates share one
/// space; convert by the chat scale before applying those logical insets.
/// This is metadata only: keep offscreen anchors so the frontend can decide
/// whether to clamp or omit its decorative tail without moving either window.
pub fn pet_render_anchor(pet: Rect, chat: Rect, chat_scale: f64) -> Option<Point> {
    asset_render_anchor(
        pet,
        chat,
        chat_scale,
        1207.,
        1303.,
        Point { x: 530., y: 390. },
    )
}

/// Same fixed window/insets, using a validated custom subject connector.
pub fn asset_render_anchor(
    pet: Rect,
    chat: Rect,
    chat_scale: f64,
    width: f64,
    height: f64,
    point: Point,
) -> Option<Point> {
    if ![width, height, point.x, point.y]
        .iter()
        .all(|v| v.is_finite())
        || width <= 0.
        || height <= 0.
        || point.x < 0.
        || point.x > width
        || point.y < 0.
        || point.y > height
    {
        return None;
    }
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
    let raster_scale = (box_width / width).min(box_height / height);
    let anchor = Point {
        x: (pet.x - chat.x) / chat_scale
            + 4.
            + (box_width - width * raster_scale) / 2.
            + point.x * raster_scale,
        y: (pet.y - chat.y) / chat_scale + 4. + box_height - height * raster_scale
            + point.y * raster_scale,
    };
    (anchor.x.is_finite() && anchor.y.is_finite()).then_some(anchor)
}

fn horizontal_chat(pet: Rect, chat: Rect, display: DisplayArea) -> Rect {
    let safe = safe_area(display);
    let (left_gap, right_gap) = adjacency_gaps(pet, display.scale, chat.width);
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

fn side_widths(pet: Rect, display: DisplayArea, preferred_width: f64) -> (f64, f64) {
    let safe = safe_area(display);
    // Fit each side using the same reservation that final positioning and the
    // frontend consume. A linked candidate must have 320px of useful body.
    // Otherwise move the backing outward by that reach and return its space to
    // reading, even when an extremely narrow display cannot offer 320px.
    let side_width = |on_left: bool| {
        let plain_space = if on_left {
            pet.x + 8. * display.scale - safe.x
        } else {
            safe.x + safe.width - pet.x - pet.width + 20. * display.scale
        };
        let reach = tail_reach(pet, display.scale, on_left);
        let linked_width = preferred_width.min(plain_space + reach * display.scale);
        if reserved_reach(pet, display.scale, on_left, linked_width) > 0. {
            linked_width
        } else {
            preferred_width.min(plain_space.max(1.))
        }
    };
    (side_width(true), side_width(false))
}

fn has_useful_side(pet: Rect, display: DisplayArea, widths: (f64, f64)) -> bool {
    [true, false].into_iter().any(|on_left| {
        let width = if on_left { widths.0 } else { widths.1 };
        width / display.scale
            - 2. * PAINT_GUTTER
            - reserved_reach(pet, display.scale, on_left, width)
            >= MIN_LINKED_WIDTH - FIT_EPSILON
    })
}

fn vertical_room(pet: Rect, display: DisplayArea) -> (f64, f64) {
    let safe = safe_area(display);
    let gap = 8. * display.scale;
    (
        (pet.y - gap - safe.y).max(0.),
        (safe.y + safe.height - pet.y - pet.height - gap).max(0.),
    )
}

fn vertical_chat(pet: Rect, chat: Rect, display: DisplayArea) -> Option<Rect> {
    let minimum_width = (MIN_LINKED_WIDTH + 2. * PAINT_GUTTER) * display.scale;
    let minimum_height = (MIN_VERTICAL_BODY_HEIGHT + 2. * PAINT_GUTTER) * display.scale;
    let epsilon = FIT_EPSILON * display.scale;
    if chat.width < minimum_width - epsilon || chat.height < minimum_height - epsilon {
        return None;
    }
    let (above, below) = vertical_room(pet, display);
    let above_fits = above >= chat.height - epsilon;
    let below_fits = below >= chat.height - epsilon;
    if !above_fits && !below_fits {
        return None;
    }
    Some(constrain(
        Rect {
            x: pet.x + pet.width / 2. - chat.width / 2.,
            y: if above_fits && (!below_fits || above >= below) {
                pet.y - 8. * display.scale - chat.height
            } else {
                pet.y + pet.height + 8. * display.scale
            },
            ..chat
        },
        safe_area(display),
    ))
}

/// Prefer the left side, then the right. If neither side can retain useful
/// reading width, use an unlinked space above/below the unchanged cat when
/// this backing fits. Physically insufficient work areas keep the existing
/// screen-clamped readable fallback; full cat separation is then impossible.
pub fn adjacent_chat(pet: Rect, chat: Rect, display: DisplayArea) -> Rect {
    if !has_useful_side(pet, display, side_widths(pet, display, chat.width)) {
        if let Some(vertical) = vertical_chat(pet, chat, display) {
            return vertical;
        }
    }
    horizontal_chat(pet, chat, display)
}

pub fn fit_companion_on_display(pet: Rect, display: DisplayArea) -> CompanionLayout {
    let safe = safe_area(display);
    let preferred_width = (CHAT_WIDTH * display.scale).min(safe.width);
    let widths = side_widths(pet, display, preferred_width);
    let preferred = Rect {
        x: 0.,
        y: 0.,
        width: preferred_width,
        height: (CHAT_HEIGHT * display.scale).min(safe.height),
    };
    let chat = if has_useful_side(pet, display, widths) {
        horizontal_chat(
            pet,
            Rect {
                width: widths.0.max(widths.1),
                ..preferred
            },
            display,
        )
    } else {
        let (above, below) = vertical_room(pet, display);
        let vertical_size = Rect {
            height: preferred.height.min(above.max(below)),
            ..preferred
        };
        vertical_chat(pet, vertical_size, display)
            .unwrap_or_else(|| horizontal_chat(pet, preferred, display))
    };
    CompanionLayout { pet, chat }
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
        assert_eq!(layout.chat.x + layout.chat.width, original.x + 52.);
        assert!(chat_is_left(original, layout.chat));
        inside(layout.chat, work());
    }
    #[test]
    fn uses_right_at_left_edge_and_clamps_when_neither_side_fits() {
        let original = pet(12., 460.);
        let layout = fit_companion(original, work());
        assert_eq!(layout.chat.x, original.x + original.width - 80.);
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
        // Neither vertical space fits a 320px body. Keep the existing readable
        // backing rather than creating a 180px body; overlap is unavoidable.
        assert_eq!(layout.chat.width, 616.);
    }
    #[test]
    fn narrows_backing_to_keep_gap_when_cat_is_near_display_center() {
        let original = pet(650., 460.);
        let layout = fit_companion(original, work());
        assert_eq!(layout.pet, original);
        assert_eq!(layout.chat.width, 690.);
        assert_eq!(layout.chat.x + layout.chat.width, original.x + 52.);
        inside(layout.chat, work());
    }
    #[test]
    fn narrow_backing_pairs_zero_reservation_with_an_outward_gap() {
        let display = DisplayArea {
            work: Rect {
                x: 0.,
                y: 0.,
                width: 844.,
                height: 1040.,
            },
            scale: 1.,
        };
        for (original, on_left, width) in [
            (pet(319., 500.), true, 315.),
            (pet(293., 500.), false, 327.),
        ] {
            let chat = adjacent_chat(
                original,
                Rect {
                    x: 0.,
                    y: 0.,
                    width,
                    height: 380.,
                },
                display,
            );
            assert_eq!(chat.width, width);
            assert_eq!(chat_is_left(original, chat), on_left);
            assert_eq!(chat_tail_reach(original, chat, 1.), Some(0.));
            let body_edge = if on_left {
                chat.x + chat.width - PAINT_GUTTER
            } else {
                chat.x + PAINT_GUTTER
            };
            let expected = if on_left {
                original.x - 8.
            } else {
                original.x + original.width - 4.
            };
            assert!((body_edge - expected).abs() < 0.000_001);
            // The rightmost measured frozen-fur point is pet.x+220.2;
            // neither side's rectangular reading body reaches into it.
            if !on_left {
                assert!(body_edge > original.x + 220.2);
            }
            assert_eq!(adjacent_chat(original, chat, display), chat);
            inside(chat, safe_area(display));
        }
    }
    #[test]
    fn fixed_backing_and_metadata_cross_the_same_linked_body_threshold() {
        for scale in [1., 1.25, 1.5, 2.] {
            for preset in [0.8, 1., 1.2] {
                for on_left in [true, false] {
                    for body_budget in [319.99, 320., 320.01] {
                        let plain_space = body_budget + 2. * PAINT_GUTTER;
                        let other_space = 200.;
                        let left_space = if on_left { plain_space } else { other_space };
                        let right_space = if on_left { other_space } else { plain_space };
                        let display = DisplayArea {
                            work: Rect {
                                x: -2000.,
                                y: -200.,
                                width: (left_space + right_space + PET_WIDTH * preset - 28.
                                    + 2. * EDGE)
                                    * scale,
                                height: 1040. * scale,
                            },
                            scale,
                        };
                        let original = Rect {
                            x: display.work.x + (EDGE + left_space - 8.) * scale,
                            y: display.work.y + 500. * scale,
                            width: PET_WIDTH * preset * scale,
                            height: PET_HEIGHT * preset * scale,
                        };
                        let expected_reach = if body_budget < MIN_LINKED_WIDTH {
                            0.
                        } else {
                            tail_reach(original, scale, on_left)
                        };
                        let chat = adjacent_chat(
                            original,
                            Rect {
                                x: 0.,
                                y: 0.,
                                width: (plain_space + expected_reach) * scale,
                                height: 380. * scale,
                            },
                            display,
                        );
                        let reach = chat_tail_reach(original, chat, scale).unwrap();
                        assert!((reach - expected_reach).abs() < 0.000_001);
                        assert_eq!(chat_is_left(original, chat), on_left);
                        assert!(
                            (chat.width / scale - 2. * PAINT_GUTTER - reach - body_budget).abs()
                                < 0.000_001
                        );
                        let body_edge = if on_left {
                            chat.x + chat.width - (PAINT_GUTTER + reach) * scale
                        } else {
                            chat.x + (PAINT_GUTTER + reach) * scale
                        };
                        let expected_edge = if on_left {
                            original.x - 8. * scale
                        } else {
                            original.x + original.width - 4. * scale
                        };
                        assert!((body_edge - expected_edge).abs() < 0.000_001);
                        assert_eq!(adjacent_chat(original, chat, display), chat);
                        inside(chat, safe_area(display));
                    }
                }
            }
        }
    }
    #[test]
    fn narrow_display_uses_readable_vertical_space_without_moving_the_cat() {
        for scale in [1., 1.25, 1.5, 2.] {
            for preset in [0.8, 1., 1.2] {
                let display = DisplayArea {
                    work: Rect {
                        x: -2000.,
                        y: -200.,
                        width: 844. * scale,
                        height: 1040. * scale,
                    },
                    scale,
                };
                for above in [true, false] {
                    let original = Rect {
                        x: display.work.x + 319. * scale,
                        y: display.work.y + if above { 500. * scale } else { EDGE * scale },
                        width: PET_WIDTH * preset * scale,
                        height: PET_HEIGHT * preset * scale,
                    };
                    let layout = fit_companion_on_display(original, display);
                    assert_eq!(layout.pet, original);
                    assert!((layout.chat.width / scale - CHAT_WIDTH).abs() < FIT_EPSILON);
                    assert_eq!(chat_tail_reach(original, layout.chat, scale), Some(0.));
                    assert!(
                        layout.chat.height / scale - 2. * PAINT_GUTTER >= MIN_VERTICAL_BODY_HEIGHT
                    );
                    if above {
                        assert!((layout.chat.height / scale - 480.).abs() < FIT_EPSILON);
                        assert!(
                            layout.chat.y + layout.chat.height
                                <= original.y - 8. * scale + FIT_EPSILON
                        );
                    } else {
                        assert!(
                            layout.chat.y
                                >= original.y + original.height + 8. * scale - FIT_EPSILON
                        );
                    }
                    assert_eq!(adjacent_chat(original, layout.chat, display), layout.chat);
                    assert_eq!(
                        fit_companion_on_display(original, display).chat,
                        layout.chat
                    );
                    inside(layout.chat, safe_area(display));
                }
            }
        }
    }
    #[test]
    fn vertical_fallback_requires_320px_of_body_height() {
        for scale in [1., 1.25, 1.5, 2.] {
            for preset in [0.8, 1., 1.2] {
                for above_height in [351.99, 352., 352.01] {
                    let display = DisplayArea {
                        work: Rect {
                            x: -2000.,
                            y: -200.,
                            width: 844. * scale,
                            height: (2. * EDGE + 16. + above_height + PET_HEIGHT * preset + 100.)
                                * scale,
                        },
                        scale,
                    };
                    let original = Rect {
                        x: display.work.x + 319. * scale,
                        y: display.work.y + (EDGE + 8. + above_height) * scale,
                        width: PET_WIDTH * preset * scale,
                        height: PET_HEIGHT * preset * scale,
                    };
                    let layout = fit_companion_on_display(original, display);
                    assert_eq!(layout.pet, original);
                    assert!((layout.chat.width / scale - CHAT_WIDTH).abs() < FIT_EPSILON);
                    if above_height >= 352. {
                        assert_eq!(chat_tail_reach(original, layout.chat, scale), Some(0.));
                        assert!((layout.chat.height / scale - above_height).abs() < FIT_EPSILON);
                        assert!(
                            layout.chat.y + layout.chat.height
                                <= original.y - 8. * scale + FIT_EPSILON
                        );
                    } else {
                        assert_eq!(layout.chat.height, CHAT_HEIGHT * scale);
                        assert!(
                            layout.chat.y < original.y + original.height
                                && layout.chat.y + layout.chat.height > original.y
                        );
                    }
                    assert_eq!(adjacent_chat(original, layout.chat, display), layout.chat);
                    inside(layout.chat, safe_area(display));
                }
            }
        }
    }
    #[test]
    fn fit_changes_reservation_and_side_at_the_same_body_width_threshold() {
        for scale in [1., 1.25, 1.5, 2.] {
            for preset in [0.8, 1., 1.2] {
                for on_left in [true, false] {
                    for body_budget in [319.99, 320., 320.01] {
                        let useful_space = body_budget + 2. * PAINT_GUTTER;
                        let left_space = if on_left { useful_space } else { 200. };
                        let right_space = if on_left { 200. } else { useful_space };
                        let display = DisplayArea {
                            work: Rect {
                                x: -2000.,
                                y: -200.,
                                width: (left_space + right_space + PET_WIDTH * preset - 28.
                                    + 2. * EDGE)
                                    * scale,
                                height: 1040. * scale,
                            },
                            scale,
                        };
                        let original = Rect {
                            x: display.work.x + (EDGE + left_space - 8.) * scale,
                            y: display.work.y + 500. * scale,
                            width: PET_WIDTH * preset * scale,
                            height: PET_HEIGHT * preset * scale,
                        };
                        let layout = fit_companion_on_display(original, display);
                        let reach = chat_tail_reach(original, layout.chat, scale).unwrap();
                        if body_budget < MIN_LINKED_WIDTH {
                            assert_eq!(reach, 0.);
                            assert!(layout.chat.y + layout.chat.height <= original.y);
                            assert!(
                                layout.chat.width / scale - 2. * PAINT_GUTTER >= MIN_LINKED_WIDTH
                            );
                        } else {
                            assert_eq!(chat_is_left(original, layout.chat), on_left);
                            assert!(
                                (reach - tail_reach(original, scale, on_left)).abs() < FIT_EPSILON
                            );
                            assert!(
                                (layout.chat.width / scale
                                    - 2. * PAINT_GUTTER
                                    - reach
                                    - body_budget)
                                    .abs()
                                    < FIT_EPSILON
                            );
                        }
                        assert_eq!(layout.pet, original);
                        assert_eq!(adjacent_chat(original, layout.chat, display), layout.chat);
                        inside(layout.chat, safe_area(display));
                    }
                }
            }
        }
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
                x: 561.,
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
            for (preset, left_reach, right_reach, left_gap, right_gap) in [
                (0.8, 35.2, 48., -43.2, -68.),
                (1., 44., 60., -52., -80.),
                (1.2, 52.8, 72., -60.8, -92.),
            ] {
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
                    let expected_gap = if on_left { left_gap } else { right_gap };
                    assert!((actual_gap - expected_gap).abs() < 0.001);
                    let reach = chat_tail_reach(original, layout.chat, scale).unwrap();
                    let expected_reach = if on_left { left_reach } else { right_reach };
                    assert!((reach - expected_reach).abs() < 0.001);
                    let body_edge = if on_left {
                        layout.chat.x + layout.chat.width - (16. + reach) * scale
                    } else {
                        layout.chat.x + (16. + reach) * scale
                    };
                    let original_body_edge = if on_left {
                        original.x - 8. * scale
                    } else {
                        original.x + original.width - 4. * scale
                    };
                    assert!((body_edge - original_body_edge).abs() < 0.001);
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
                    assert!(face_left + 8. > 0.);
                    assert!(pet_width - 4. - fur_right > 0.);
                }
            }
        }
    }
    #[test]
    fn different_chat_sizes_preserve_the_same_body_edge_and_cat_rectangle() {
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
                        x: if on_left {
                            -460. * scale
                        } else {
                            -2520. * scale
                        },
                        y: 400. * scale,
                        width: PET_WIDTH * preset * scale,
                        height: PET_HEIGHT * preset * scale,
                    };
                    for (width, height) in [(360., 380.), (420., 380.), (720., 680.)] {
                        let chat = adjacent_chat(
                            original,
                            Rect {
                                x: 0.,
                                y: 0.,
                                width: width * scale,
                                height: height * scale,
                            },
                            display,
                        );
                        let reach = chat_tail_reach(original, chat, scale).unwrap();
                        let body_edge = if on_left {
                            chat.x + chat.width - (16. + reach) * scale
                        } else {
                            chat.x + (16. + reach) * scale
                        };
                        let expected = if on_left {
                            original.x - 8. * scale
                        } else {
                            original.x + original.width - 4. * scale
                        };
                        assert!((body_edge - expected).abs() < 0.001);
                        assert_eq!(chat_is_left(original, chat), on_left);
                        assert_eq!(chat.width, width * scale);
                        assert_eq!(chat.height, height * scale);
                        assert_eq!(adjacent_chat(original, chat, display), chat);
                        inside(chat, safe_area(display));
                    }
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
            assert!((layout.chat.x + layout.chat.width - original.x - 52. * scale).abs() < 0.001);
            assert_eq!(chat_tail_reach(original, layout.chat, scale), Some(44.));
            assert!(
                (layout.chat.x + layout.chat.width - 60. * scale - (original.x - 8. * scale)).abs()
                    < 0.001
            );
            inside(layout.chat, display.work);
        }
    }
    #[test]
    fn tail_reach_metadata_omits_invalid_coordinates_and_scale() {
        let pet = pet(1000., 340.);
        let chat = Rect {
            x: 332.,
            y: 0.,
            width: 720.,
            height: 680.,
        };
        assert_eq!(chat_tail_reach(pet, chat, 1.), Some(44.));
        for scale in [0., -1., f64::NAN, f64::INFINITY, f64::MIN_POSITIVE] {
            assert_eq!(chat_tail_reach(pet, chat, scale), None);
        }
        for invalid in [
            Rect { x: f64::NAN, ..pet },
            Rect {
                y: f64::INFINITY,
                ..pet
            },
            Rect { width: 0., ..pet },
            Rect { height: -1., ..pet },
            Rect {
                x: f64::MAX,
                width: f64::MAX,
                ..pet
            },
        ] {
            assert_eq!(chat_tail_reach(invalid, chat, 1.), None);
            assert_eq!(chat_tail_reach(pet, invalid, 1.), None);
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

#[cfg(test)]
mod custom_anchor_tests {
    use super::*;
    #[test]
    fn custom_connector_uses_its_own_canvas_and_same_native_insets() {
        let pet = Rect {
            x: 500.,
            y: 100.,
            width: 232.,
            height: 340.,
        };
        let chat = Rect {
            x: 0.,
            y: 0.,
            width: 720.,
            height: 680.,
        };
        let point =
            asset_render_anchor(pet, chat, 1., 768., 960., Point { x: 384., y: 320. }).unwrap();
        let scale = 271. / 960.;
        assert!((point.x - 616.).abs() < 0.001);
        assert!((point.y - (104. + 320. * scale)).abs() < 0.001);
        assert!(
            asset_render_anchor(pet, chat, 1., 768., 960., Point { x: 900., y: 320. }).is_none()
        );
    }
}
