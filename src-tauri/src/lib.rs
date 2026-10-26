mod agent_protocol;
mod backend;
mod companion_preferences;
mod customization;
mod llm;
mod local_agent;
#[cfg(debug_assertions)]
mod motion_diagnostics;
mod window_geometry;
use companion_preferences::{CompanionPreferences, CompanionPreferencesState};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition};
use window_geometry::{
    DisplayArea, Rect, PET_HEIGHT as PET_CLOSED_HEIGHT, PET_WIDTH as PET_CLOSED_WIDTH,
};

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(DesktopPetPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

#[cfg(target_os = "macos")]
fn make_visible_on_every_space(
    window: tauri::WebviewWindow,
    accepts_keyboard_input: bool,
) -> Result<(), String> {
    use tauri_nspanel::{
        objc2_app_kit::NSWindowCollectionBehavior,
        objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo},
    };

    let panel = window
        .to_panel::<DesktopPetPanel>()
        .map_err(|error| format!("将窗口转换为 macOS NSPanel 失败：{error}"))?;

    // Keyboard focus may reorder windows within a level. Keep the one real
    // cat in a permanently higher band than its chat dock, without making the
    // cat key or preventing the chat composer from receiving keyboard input.
    let level = PanelLevel::Floating.value() + if window.label() == "main" { 1 } else { 0 };
    panel.set_level(level);
    let style_mask = if accepts_keyboard_input {
        StyleMask::empty().borderless()
    } else {
        StyleMask::empty().borderless().nonactivating_panel()
    };
    panel.set_style_mask(style_mask.into());
    let mut behavior = CollectionBehavior::new()
        .can_join_all_spaces()
        .full_screen_auxiliary()
        .stationary()
        .ignores_cycle()
        .value();
    // All-spaces alone left both panels on the ordinary desktop while another
    // app occupied a full-screen Space on macOS 26. AppKit's macOS 13+ behavior
    // explicitly permits floating windows to join other applications' spaces.
    if NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
        majorVersion: 13,
        minorVersion: 0,
        patchVersion: 0,
    }) {
        behavior |= NSWindowCollectionBehavior::CanJoinAllApplications;
    }
    panel.set_collection_behavior(behavior);
    // Finder becomes active again immediately after launching an accessory
    // application. Keep the desktop-pet panel visible across that focus change.
    panel.set_hides_on_deactivate(false);

    Ok(())
}

const WINDOW_EDGE_MARGIN: f64 = 24.0;
const PET_BOTTOM_MARGIN: f64 = 80.0;
const PET_POSITION_FILE: &str = "pet-position.json";
const PET_LEGACY_CLOSED_WIDTH: f64 = 184.0;
const PET_LEGACY_CLOSED_HEIGHT: f64 = 300.0;
// All native IPC yields before touching AppKit. The closure runs on the event
// loop after the WebKit IPC callback has returned; no synchronous channel wait
// or raw NSPanel call is allowed on an arbitrary command worker.
async fn on_ui<T: Send + 'static>(
    app: AppHandle,
    operation: impl FnOnce(AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let current = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(operation(current));
    })
    .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|_| "原生窗口操作未完成".to_owned())?
}

#[derive(Debug, Deserialize, Serialize)]
struct StoredPetPosition {
    x: i32,
    y: i32,
    #[serde(default)]
    version: u8,
}

fn physical_pixels(logical_pixels: f64, scale_factor: f64) -> i32 {
    (logical_pixels * scale_factor).round() as i32
}

fn position_pet_at_default(app: &AppHandle) -> Result<PhysicalPosition<i32>, String> {
    let pet = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_owned())?;
    let monitor = pet
        .primary_monitor()
        .map_err(|error| format!("无法获取主屏幕：{error}"))?
        .ok_or_else(|| "未检测到主屏幕".to_owned())?;
    let pet_size = pet
        .outer_size()
        .map_err(|error| format!("无法获取桌宠尺寸：{error}"))?;
    let monitor_position = &monitor.work_area().position;
    let monitor_size = &monitor.work_area().size;
    let right_margin = physical_pixels(WINDOW_EDGE_MARGIN, monitor.scale_factor());
    let bottom_margin = physical_pixels(PET_BOTTOM_MARGIN, monitor.scale_factor());
    let x = monitor_position.x + monitor_size.width as i32 - pet_size.width as i32 - right_margin;
    let y =
        monitor_position.y + monitor_size.height as i32 - pet_size.height as i32 - bottom_margin;

    let position = PhysicalPosition::new(x, y);
    pet.set_position(position)
        .map_err(|error| format!("无法设置桌宠位置：{error}"))?;
    Ok(position)
}

fn position_pet_at_bottom_right(app: &AppHandle) -> Result<(), String> {
    let pet = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_owned())?;
    let monitor = pet
        .primary_monitor()
        .map_err(|error| format!("无法获取主屏幕：{error}"))?
        .ok_or_else(|| "未检测到主屏幕".to_owned())?;
    let pet_size = pet
        .outer_size()
        .map_err(|error| format!("无法获取桌宠尺寸：{error}"))?;

    if let Some(saved) = load_pet_position(app) {
        let (saved_x, saved_y) = if saved.version >= 2 {
            (
                saved.x - pet_size.width as i32,
                saved.y - pet_size.height as i32,
            )
        } else {
            // Version 1 stored the old 184×300 closed window's top-left.
            // Convert it once to the same bottom-right anchor used by v2.
            (
                saved.x + physical_pixels(PET_LEGACY_CLOSED_WIDTH, monitor.scale_factor())
                    - pet_size.width as i32,
                saved.y + physical_pixels(PET_LEGACY_CLOSED_HEIGHT, monitor.scale_factor())
                    - pet_size.height as i32,
            )
        };
        let monitors = pet
            .available_monitors()
            .map_err(|error| format!("无法获取屏幕列表：{error}"))?;
        let visible_monitor = monitors.iter().find(|candidate| {
            let position = &candidate.work_area().position;
            let size = &candidate.work_area().size;
            let right = position.x + size.width as i32;
            let bottom = position.y + size.height as i32;
            saved_x < right
                && saved_x + pet_size.width as i32 > position.x
                && saved_y < bottom
                && saved_y + pet_size.height as i32 > position.y
        });
        if let Some(candidate) = visible_monitor {
            let work = candidate.work_area();
            let restored = window_geometry::constrain(
                Rect {
                    x: saved_x as f64,
                    y: saved_y as f64,
                    width: pet_size.width as f64,
                    height: pet_size.height as f64,
                },
                Rect {
                    x: work.position.x as f64,
                    y: work.position.y as f64,
                    width: work.size.width as f64,
                    height: work.size.height as f64,
                },
            );
            return pet
                .set_position(PhysicalPosition::new(
                    restored.x.round() as i32,
                    restored.y.round() as i32,
                ))
                .map_err(|error| format!("无法恢复桌宠位置：{error}"));
        }
    }

    position_pet_at_default(app).map(|_| ())
}

fn pet_position_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(PET_POSITION_FILE))
        .map_err(|error| format!("无法确定桌宠配置目录：{error}"))
}

fn load_pet_position(app: &AppHandle) -> Option<StoredPetPosition> {
    let bytes = std::fs::read(pet_position_path(app).ok()?).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[tauri::command]
async fn save_pet_position(app: AppHandle, mut position: StoredPetPosition) -> Result<(), String> {
    let current_size = on_ui(app.clone(), |app| {
        let pet = app
            .get_webview_window("main")
            .ok_or_else(|| "找不到桌宠窗口".to_owned())?;
        pet.outer_size()
            .map_err(|error| format!("无法获取桌宠尺寸：{error}"))
    })
    .await?;
    position.x += current_size.width as i32;
    position.y += current_size.height as i32;
    position.version = 2;

    let path = pet_position_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = path.parent().ok_or_else(|| "桌宠配置目录无效".to_owned())?;
        std::fs::create_dir_all(directory)
            .map_err(|error| format!("创建桌宠配置目录失败：{error}"))?;
        let bytes = serde_json::to_vec(&position)
            .map_err(|error| format!("序列化桌宠位置失败：{error}"))?;
        std::fs::write(path, bytes).map_err(|error| format!("保存桌宠位置失败：{error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn reset_pet_position(app: AppHandle) -> Result<(), String> {
    let position = on_ui(app.clone(), |app| {
        let position = position_pet_at_default(&app)?;
        if app.state::<ChatHitState>().visible.load(Ordering::Relaxed) {
            align_visible_chat(&app)?;
        }

        Ok(position)
    })
    .await?;

    // Persist the reset immediately. The normal onMoved debounce will also
    // observe this move, but the command must use the calculated destination
    // because AppKit can briefly return the previous position after setPosition.
    save_pet_position(
        app,
        StoredPetPosition {
            x: position.x,
            y: position.y,
            version: 0,
        },
    )
    .await
}

#[tauri::command]
async fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[derive(Clone, Copy, Default, Deserialize)]
struct ChatHitBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Default)]
struct ChatHitState {
    bounds: Mutex<ChatHitBounds>,
    visible: AtomicBool,
    hidden: AtomicBool,
    dragging: AtomicBool,
    poll_pending: AtomicBool,
    drag_id: Mutex<String>,
}

#[cfg(target_os = "macos")]
fn update_chat_pointer_policy(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ChatHitState>();
    let panel = app
        .get_webview_panel("chat")
        .map_err(|error| format!("无法获取聊天面板：{error:?}"))?;
    let bounds = *state.bounds.lock().map_err(|_| "聊天命中区域不可用")?;
    let accepts = if !state.visible.load(Ordering::Relaxed) {
        false
    } else if state.dragging.load(Ordering::Relaxed) {
        true
    } else {
        unsafe {
            let mouse: tauri_nspanel::NSPoint = tauri_nspanel::objc2::msg_send![
                tauri_nspanel::objc2::class!(NSEvent),
                mouseLocation
            ];
            let frame: tauri_nspanel::NSRect =
                tauri_nspanel::objc2::msg_send![panel.as_panel(), frame];
            let x = mouse.x - frame.origin.x;
            let y = frame.origin.y + frame.size.height - mouse.y;
            x >= bounds.x
                && x < bounds.x + bounds.width
                && y >= bounds.y
                && y < bounds.y + bounds.height
        }
    };
    panel.set_ignores_mouse_events(!accepts);
    Ok(())
}

#[tauri::command]
async fn set_chat_hit_bounds(
    app: AppHandle,
    window: tauri::WebviewWindow,
    bounds: ChatHitBounds,
) -> Result<(), String> {
    on_ui(app, move |app| {
        set_chat_hit_bounds_on_main(app, window, bounds)
    })
    .await
}

fn set_chat_hit_bounds_on_main(
    app: AppHandle,
    window: tauri::WebviewWindow,
    bounds: ChatHitBounds,
) -> Result<(), String> {
    if window.label() != "chat" {
        return Err("仅聊天窗口可更新命中区域".to_owned());
    }
    if ![bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .all(|value| value.is_finite())
    {
        return Err("聊天命中区域无效".to_owned());
    }
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    let x = bounds.x.clamp(0.0, width);
    let y = bounds.y.clamp(0.0, height);
    *app.state::<ChatHitState>()
        .bounds
        .lock()
        .map_err(|_| "聊天命中区域不可用")? = ChatHitBounds {
        x,
        y,
        width: bounds.width.clamp(0.0, width - x),
        height: bounds.height.clamp(0.0, height - y),
    };
    #[cfg(target_os = "macos")]
    update_chat_pointer_policy(&app)?;
    Ok(())
}

#[tauri::command]
async fn end_pet_group_drag(app: AppHandle, drag_id: String) -> Result<(), String> {
    on_ui(app, move |app| end_pet_group_drag_on_main(app, drag_id)).await
}

fn end_pet_group_drag_on_main(app: AppHandle, drag_id: String) -> Result<(), String> {
    let state = app.state::<ChatHitState>();
    if *state.drag_id.lock().map_err(|_| "拖动状态不可用")? == drag_id {
        state.dragging.store(false, Ordering::Relaxed);
        // Refit/reposition once after release, never on pointer-move frames.
        if state.visible.load(Ordering::Relaxed) {
            align_visible_chat(&app)?;
        }
        #[cfg(target_os = "macos")]
        update_chat_pointer_policy(&app)?;
    }
    Ok(())
}

#[derive(Clone, Copy, Serialize)]
struct PetAnchor {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Serialize)]
struct PanelViewport {
    width: f64,
    height: f64,
    side: &'static str,
    #[serde(rename = "petAnchor")]
    pet_anchor: Option<PetAnchor>,
    #[serde(rename = "tailReach", skip_serializing_if = "Option::is_none")]
    tail_reach: Option<f64>,
}

#[cfg(target_os = "macos")]
fn window_rect(app: &AppHandle, label: &str) -> Result<Rect, String> {
    let panel = app
        .get_webview_panel(label)
        .map_err(|error| format!("无法获取面板：{error:?}"))?;
    let frame: tauri_nspanel::NSRect =
        unsafe { tauri_nspanel::objc2::msg_send![panel.as_panel(), frame] };
    // AppKit points form one global space, even across mixed-DPI displays.
    // Negating the vertical axis gives the same downward delta as DOM screenY.
    Ok(Rect {
        x: frame.origin.x,
        y: -frame.origin.y - frame.size.height,
        width: frame.size.width,
        height: frame.size.height,
    })
}

#[cfg(not(target_os = "macos"))]
fn window_rect(app: &AppHandle, label: &str) -> Result<Rect, String> {
    let window = app.get_webview_window(label).ok_or("找不到桌宠窗口")?;
    let pos = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    Ok(Rect {
        x: pos.x as f64,
        y: pos.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    })
}

fn place_window(app: &AppHandle, label: &str, rect: Rect, resize: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let panel = app
            .get_webview_panel(label)
            .map_err(|error| format!("无法获取面板：{error:?}"))?;
        let frame = tauri_nspanel::NSRect::new(
            tauri_nspanel::NSPoint::new(rect.x, -rect.y - rect.height),
            tauri_nspanel::NSSize::new(rect.width, rect.height),
        );
        unsafe {
            if resize {
                let _: () = tauri_nspanel::objc2::msg_send![panel.as_panel(), setFrame: frame, display: true];
            } else {
                let _: () =
                    tauri_nspanel::objc2::msg_send![panel.as_panel(), setFrameOrigin: frame.origin];
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = app.get_webview_window(label).ok_or("找不到桌宠窗口")?;
        window
            .set_position(PhysicalPosition::new(
                rect.x.round() as i32,
                rect.y.round() as i32,
            ))
            .map_err(|error| error.to_string())?;
        if resize {
            window
                .set_size(tauri::PhysicalSize::new(
                    rect.width.round() as u32,
                    rect.height.round() as u32,
                ))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn display_for(app: &AppHandle, pet: Rect) -> Result<DisplayArea, String> {
    #[cfg(target_os = "macos")]
    let areas = {
        use tauri_nspanel::{
            objc2::{class, msg_send, runtime::AnyObject},
            objc2_foundation::NSArray,
        };
        let screens: *mut NSArray<AnyObject> = unsafe { msg_send![class!(NSScreen), screens] };
        let screens = unsafe { screens.as_ref() }.ok_or("未检测到屏幕")?;
        screens
            .iter()
            .map(|screen| {
                let frame: tauri_nspanel::NSRect = unsafe { msg_send![&*screen, visibleFrame] };
                DisplayArea {
                    work: Rect {
                        x: frame.origin.x,
                        y: -frame.origin.y - frame.size.height,
                        width: frame.size.width,
                        height: frame.size.height,
                    },
                    scale: 1.0,
                }
            })
            .collect::<Vec<_>>()
    };
    #[cfg(not(target_os = "macos"))]
    let areas = app
        .get_webview_window("main")
        .ok_or("找不到桌宠窗口")?
        .available_monitors()
        .map_err(|error| error.to_string())?
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            let scale = monitor.scale_factor();
            DisplayArea {
                work: Rect {
                    x: area.position.x as f64,
                    y: area.position.y as f64,
                    width: area.size.width as f64,
                    height: area.size.height as f64,
                },
                scale,
            }
        })
        .collect::<Vec<_>>();
    let _ = app;
    window_geometry::nearest_display(pet, &areas).ok_or_else(|| "未检测到屏幕".to_owned())
}

fn align_visible_chat(app: &AppHandle) -> Result<(), String> {
    let pet = window_rect(app, "main")?;
    let chat = window_rect(app, "chat")?;
    let display = display_for(app, pet)?;
    let fitted = window_geometry::fit_companion_on_display(pet, display).chat;
    let resize = window_geometry::needs_refit(chat, display)
        || chat.width > fitted.width + 0.5
        || chat.height > fitted.height + 0.5;
    let size = if resize {
        Rect {
            width: chat.width.min(fitted.width),
            height: chat.height.min(fitted.height),
            ..chat
        }
    } else {
        chat
    };
    let target = window_geometry::adjacent_chat(pet, size, display);
    if resize {
        *app.state::<ChatHitState>()
            .bounds
            .lock()
            .map_err(|_| "聊天命中区域不可用")? = ChatHitBounds::default();
    }
    place_window(app, "chat", target, resize)?;
    app.emit_to("chat", "pet-panel:viewport-changed", panel_viewport(app)?)
        .map_err(|error| error.to_string())
}

// Backing size changes only while hidden. Both modes share that prepared
// backing until close; visible transitions never resize the cat or chat.
#[tauri::command]
async fn set_pet_chat_mode(app: AppHandle, mode: String) -> Result<PanelViewport, String> {
    on_ui(app, move |app| set_pet_chat_mode_on_main(app, mode)).await
}

fn set_pet_chat_mode_on_main(app: AppHandle, mode: String) -> Result<PanelViewport, String> {
    let chat = app.get_webview_window("chat").ok_or("找不到聊天窗口")?;
    let state = app.state::<ChatHitState>();
    if mode == "closed" {
        // Resolve everything that can fail before changing native visibility.
        // A rejected hide must leave the existing interaction state usable.
        let viewport = panel_viewport(&app)?;
        #[cfg(target_os = "macos")]
        let panel = app
            .get_webview_panel("chat")
            .map_err(|error| format!("无法获取聊天面板：{error:?}"))?;
        chat.hide()
            .map_err(|error| format!("无法隐藏聊天窗口：{error}"))?;
        state.visible.store(false, Ordering::Relaxed);
        state.dragging.store(false, Ordering::Relaxed);
        #[cfg(target_os = "macos")]
        panel.set_ignores_mouse_events(true);
        return Ok(viewport);
    } else if mode != "compact" && mode != "expanded" {
        return Err(format!("不支持的桌宠对话模式：{mode}"));
    } else if state.hidden.load(Ordering::Relaxed) {
        return Err("桌宠已隐藏，请从菜单栏恢复".to_owned());
    } else if !state.visible.load(Ordering::Relaxed) {
        *state.bounds.lock().map_err(|_| "聊天命中区域不可用")? = ChatHitBounds::default();
        let pet = window_rect(&app, "main")?;
        let layout = window_geometry::fit_companion_on_display(pet, display_for(&app, pet)?);
        place_window(&app, "chat", layout.chat, true)?;
    }
    panel_viewport(&app)
}

fn panel_viewport(app: &AppHandle) -> Result<PanelViewport, String> {
    let frame = window_rect(app, "chat")?;
    #[cfg(target_os = "macos")]
    let scale = 1.0;
    #[cfg(not(target_os = "macos"))]
    let scale = app
        .get_webview_window("chat")
        .ok_or("找不到聊天窗口")?
        .scale_factor()
        .map_err(|error| error.to_string())?;
    let pet = window_rect(app, "main")?;
    Ok(PanelViewport {
        width: frame.width / scale,
        height: frame.height / scale,
        side: if window_geometry::chat_is_left(pet, frame) {
            "left"
        } else {
            "right"
        },
        tail_reach: window_geometry::chat_tail_reach(pet, frame, scale),
        pet_anchor: customization::active_geometry(app).map_or_else(
            || window_geometry::pet_render_anchor(pet, frame, scale),
            |asset| window_geometry::asset_render_anchor(pet, frame, scale, asset.width as f64, asset.height as f64,
                window_geometry::Point { x: asset.connector_x.unwrap_or(asset.width/2) as f64, y: asset.connector_y.unwrap_or(asset.height/3) as f64 })
        ).map(|point| PetAnchor {
            x: point.x,
            y: point.y,
        }),
    })
}

#[cfg(not(target_os = "macos"))]
fn make_visible_on_every_space(
    _window: tauri::WebviewWindow,
    _accepts_keyboard_input: bool,
) -> Result<(), String> {
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
struct PetDragOrigin {
    main_x: f64,
    main_y: f64,
    chat_x: f64,
    chat_y: f64,
    scale: f64,
}

#[tauri::command]
async fn pet_drag_origin(
    app: AppHandle,
    window: tauri::WebviewWindow,
    drag_id: String,
) -> Result<PetDragOrigin, String> {
    on_ui(app, move |app| {
        pet_drag_origin_on_main(app, window, drag_id)
    })
    .await
}

fn pet_drag_origin_on_main(
    app: AppHandle,
    window: tauri::WebviewWindow,
    drag_id: String,
) -> Result<PetDragOrigin, String> {
    *app.state::<ChatHitState>()
        .drag_id
        .lock()
        .map_err(|_| "拖动状态不可用")? = drag_id;
    app.state::<ChatHitState>()
        .dragging
        .store(window.label() == "chat", Ordering::Relaxed);
    let a = window_rect(&app, "main")?;
    let b = window_rect(&app, "chat")?;
    #[cfg(target_os = "macos")]
    let scale = 1.0;
    #[cfg(not(target_os = "macos"))]
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    Ok(PetDragOrigin {
        main_x: a.x,
        main_y: a.y,
        chat_x: b.x,
        chat_y: b.y,
        scale,
    })
}

#[tauri::command]
async fn move_pet_group(
    app: AppHandle,
    origin: PetDragOrigin,
    delta_x: f64,
    delta_y: f64,
) -> Result<(), String> {
    on_ui(app, move |app| {
        move_pet_group_on_main(app, origin, delta_x, delta_y)
    })
    .await
}

fn move_pet_group_on_main(
    app: AppHandle,
    origin: PetDragOrigin,
    delta_x: f64,
    delta_y: f64,
) -> Result<(), String> {
    if !delta_x.is_finite()
        || !delta_y.is_finite()
        || !origin.scale.is_finite()
        || origin.scale <= 0.0
    {
        return Err("拖动坐标无效".to_owned());
    }
    let pet = window_rect(&app, "main")?;
    let chat = window_rect(&app, "chat")?;
    let delta_x = delta_x * origin.scale;
    let delta_y = delta_y * origin.scale;
    let candidate = Rect {
        x: origin.main_x + delta_x,
        y: origin.main_y + delta_y,
        ..pet
    };
    let display = display_for(&app, candidate)?;
    let visible = app.state::<ChatHitState>().visible.load(Ordering::Relaxed);
    let layout = window_geometry::constrain_companion_drag(
        window_geometry::CompanionLayout {
            pet: candidate,
            chat: Rect {
                x: origin.chat_x + delta_x,
                y: origin.chat_y + delta_y,
                ..chat
            },
        },
        visible,
        display,
    );
    // Both origins come from one pointer-down and one AppKit point space.
    // Clamping uses one shared delta for both independent rectangles.
    place_window(&app, "main", layout.pet, false)?;
    place_window(&app, "chat", layout.chat, false)?;
    Ok(())
}

#[tauri::command]
async fn show_chat_window(app: AppHandle) -> Result<(), String> {
    on_ui(app, move |app| show_chat_window_on_main(app)).await
}

fn show_chat_window_on_main(app: AppHandle) -> Result<(), String> {
    if app.state::<ChatHitState>().hidden.load(Ordering::Relaxed) {
        return Err("桌宠已隐藏，请从菜单栏恢复".to_owned());
    }
    #[cfg(target_os = "macos")]
    {
        let panel = app
            .get_webview_panel("chat")
            .map_err(|error| format!("无法获取聊天面板：{error:?}"))?;
        let pet = app
            .get_webview_panel("main")
            .map_err(|error| format!("无法获取桌宠面板：{error:?}"))?;
        let window = app
            .get_webview_window("chat")
            .ok_or_else(|| "找不到聊天窗口".to_owned())?;
        panel.show_and_make_key();
        app.state::<ChatHitState>()
            .visible
            .store(true, Ordering::Relaxed);
        // The window is now visible even if focus fails. Keep this flag true
        // for same-mode retries; the cold-open caller closes on failure.
        update_chat_pointer_policy(&app)?;
        // Restore the cat's visual order without taking keyboard focus away
        // from the composer.
        pet.order_front_regardless();
        // NSPanel focuses its content view, which Wry wraps around WKWebView.
        // Target the actual webview without resetting its DOM selection.
        let webview: &tauri::Webview = window.as_ref();
        webview
            .set_focus()
            .map_err(|error| format!("聚焦聊天内容失败：{error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = app
            .get_webview_window("chat")
            .ok_or_else(|| "找不到聊天窗口".to_owned())?;
        window
            .show()
            .map_err(|error| format!("显示聊天窗口失败：{error}"))?;
        app.state::<ChatHitState>()
            .visible
            .store(true, Ordering::Relaxed);
        window
            .set_focus()
            .map_err(|error| format!("聚焦聊天窗口失败：{error}"))?;
        Ok(())
    }
}

#[tauri::command]
async fn set_chat_window_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    set_pet_chat_mode(
        app,
        if expanded { "expanded" } else { "compact" }.to_owned(),
    )
    .await
    .map(|_| ())
}

fn preferences_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(companion_preferences::FILE_NAME))
        .map_err(|error| format!("无法确定桌宠偏好目录：{error}"))
}

#[tauri::command]
fn get_companion_preferences(app: AppHandle) -> Result<CompanionPreferences, String> {
    app.state::<CompanionPreferencesState>().get()
}

fn apply_companion_preferences(
    app: &AppHandle,
    preferences: CompanionPreferences,
) -> Result<(), String> {
    let pet = window_rect(app, "main")?;
    let display = display_for(app, pet)?;
    let width = PET_CLOSED_WIDTH * preferences.scale * display.scale;
    let height = PET_CLOSED_HEIGHT * preferences.scale * display.scale;
    // Preserve the bottom-right anchor when the user explicitly changes size.
    let target = window_geometry::constrain(
        Rect {
            x: pet.x + pet.width - width,
            y: pet.y + pet.height - height,
            width,
            height,
        },
        display.work,
    );
    if (pet.width - width).abs() > 0.01 || (pet.height - height).abs() > 0.01 {
        place_window(app, "main", target, true)?;
    }
    for label in ["main", "chat"] {
        #[cfg(target_os = "macos")]
        {
            let panel = app
                .get_webview_panel(label)
                .map_err(|error| format!("无法获取桌宠面板：{error:?}"))?;
            panel.set_floating_panel(preferences.always_on_top);
            // Normal windows share level zero when unpinned. Raising the cat to
            // level one would still cover ordinary windows after unpinning.
            panel.set_level(if preferences.always_on_top {
                PanelLevel::Floating.value() + if label == "main" { 1 } else { 0 }
            } else {
                0
            });
        }
        #[cfg(not(target_os = "macos"))]
        app.get_webview_window(label)
            .ok_or("找不到桌宠窗口")?
            .set_always_on_top(preferences.always_on_top)
            .map_err(|error| error.to_string())?;
    }
    if app.state::<ChatHitState>().visible.load(Ordering::Relaxed) {
        align_visible_chat(app)?;
    }
    Ok(())
}

#[tauri::command]
async fn set_companion_preferences(
    app: AppHandle,
    preferences: CompanionPreferences,
) -> Result<CompanionPreferences, String> {
    let preferences = preferences.validate()?;
    let path = preferences_path(&app)?;
    let state = app.state::<CompanionPreferencesState>();
    let _write = state.write_lock.lock().await;
    let previous = state.get()?;
    if let Err(error) = on_ui(app.clone(), move |app| {
        apply_companion_preferences(&app, preferences)
    })
    .await
    {
        let rollback = on_ui(app.clone(), move |app| {
            apply_companion_preferences(&app, previous)
        })
        .await;
        return Err(match rollback {
            Ok(()) => error,
            Err(rollback) => format!("{error}；恢复原偏好失败：{rollback}"),
        });
    }
    let stored = tauri::async_runtime::spawn_blocking(move || {
        companion_preferences::save(&path, preferences)
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|result| result);
    if let Err(error) = stored {
        let rollback = on_ui(app.clone(), move |app| {
            apply_companion_preferences(&app, previous)
        })
        .await;
        return Err(match rollback {
            Ok(()) => error,
            Err(rollback) => format!("{error}；恢复原偏好失败：{rollback}"),
        });
    }
    *state
        .current
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = preferences;
    // Disk and native state are committed. Notification/menu failures must not
    // turn that successful write into an ambiguous rejected save. Callers get
    // the actual committed value; the event remains the cross-window update.
    if let Err(error) = app.emit("companion:preferences-changed", preferences) {
        eprintln!("Companion preferences committed; event delivery failed: {error}");
    }
    if let Err(error) = on_ui(app.clone(), move |app| refresh_companion_tray(&app)).await {
        let _ = app.emit(
            "companion:error",
            "桌宠偏好已保存，菜单栏状态未刷新，请重新选择一次。",
        );
        eprintln!("Companion preferences committed; tray refresh failed: {error}");
    }
    Ok(preferences)
}

#[tauri::command]
async fn hide_companion(app: AppHandle) -> Result<(), String> {
    on_ui(app, |app| {
        // Do not allow hiding to strand the user without a recovery control.
        if app.tray_by_id("companion").is_none() {
            return Err("菜单栏恢复入口尚未就绪，暂时无法隐藏".to_owned());
        }
        let state = app.state::<ChatHitState>();
        let main = app.get_webview_window("main").ok_or("找不到桌宠窗口")?;
        // One UI transaction: no other queued open can interleave. Hide the
        // cat first so a failed first step changes no chat or hidden state.
        main.hide().map_err(|error| error.to_string())?;
        if let Err(error) = set_pet_chat_mode_on_main(app.clone(), "closed".to_owned()) {
            if !state.hidden.load(Ordering::Relaxed) {
                if let Err(rollback) = main.show() {
                    return Err(format!("{error}；恢复桌宠显示失败：{rollback}"));
                }
            }
            return Err(error);
        }
        state.hidden.store(true, Ordering::Relaxed);
        emit_companion_visibility(&app, false);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn show_companion(app: AppHandle) -> Result<(), String> {
    on_ui(app, |app| {
        let pet = window_rect(&app, "main")?;
        let work = display_for(&app, pet)?.work;
        set_pet_chat_mode_on_main(app.clone(), "closed".to_owned())?;
        place_window(&app, "main", window_geometry::constrain(pet, work), false)?;
        #[cfg(target_os = "macos")]
        {
            let panel = app
                .get_webview_panel("main")
                .map_err(|error| format!("无法获取桌宠面板：{error:?}"))?;
            panel.show();
            panel.order_front_regardless();
        }
        #[cfg(not(target_os = "macos"))]
        app.get_webview_window("main")
            .ok_or("找不到桌宠窗口")?
            .show()
            .map_err(|error| error.to_string())?;
        app.state::<ChatHitState>()
            .hidden
            .store(false, Ordering::Relaxed);
        emit_companion_visibility(&app, true);
        Ok(())
    })
    .await
}

fn emit_companion_visibility(app: &AppHandle, visible: bool) {
    // Native visibility is already committed. Event transport is a separate
    // outcome; rejecting here would falsely report that hiding/showing failed.
    if let Err(error) = app.emit("companion:visibility-changed", visible) {
        eprintln!("Companion visibility committed; event delivery failed: {error}");
    }
    if let Err(error) = app.emit_to("main", "pet-panel:committed", "closed") {
        eprintln!("Companion visibility committed; panel notification failed: {error}");
    }
}

fn companion_tray_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, String> {
    let preferences = app.state::<CompanionPreferencesState>().get()?;
    let build = || -> tauri::Result<Menu<tauri::Wry>> {
        let show = MenuItem::with_id(app, "companion.show", "显示橘伴", true, None::<&str>)?;
        let hide = MenuItem::with_id(app, "companion.hide", "隐藏橘伴", true, None::<&str>)?;
        let small = CheckMenuItem::with_id(
            app,
            "companion.size.small",
            "小 · 80%",
            true,
            preferences.scale == 0.8,
            None::<&str>,
        )?;
        let normal = CheckMenuItem::with_id(
            app,
            "companion.size.normal",
            "标准 · 100%",
            true,
            preferences.scale == 1.0,
            None::<&str>,
        )?;
        let large = CheckMenuItem::with_id(
            app,
            "companion.size.large",
            "大 · 120%",
            true,
            preferences.scale == 1.2,
            None::<&str>,
        )?;
        let size = Submenu::with_items(app, "桌宠大小", true, &[&small, &normal, &large])?;
        let pin = CheckMenuItem::with_id(
            app,
            "companion.pin",
            "保持置顶",
            true,
            preferences.always_on_top,
            None::<&str>,
        )?;
        let reset = MenuItem::with_id(app, "companion.reset", "恢复桌宠位置", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "companion.quit", "退出橘伴", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        Menu::with_items(app, &[&show, &hide, &size, &pin, &reset, &separator, &quit])
    };
    build().map_err(|error| format!("创建菜单栏菜单失败：{error}"))
}

fn refresh_companion_tray(app: &AppHandle) -> Result<(), String> {
    let tray = app.tray_by_id("companion").ok_or("菜单栏恢复入口不可用")?;
    tray.set_menu(Some(companion_tray_menu(app)?))
        .map_err(|error| error.to_string())
}

fn install_companion_tray(app: &AppHandle) -> Result<(), String> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .map_err(|error| format!("读取桌宠菜单栏图标失败：{error}"))?;
    TrayIconBuilder::with_id("companion")
        .icon(icon)
        .tooltip("橘伴")
        .menu(&companion_tray_menu(app)?)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let action = event.id().as_ref().to_owned();
            if !action.starts_with("companion.") {
                return;
            }
            let app = app.clone();
            // Menu callbacks return immediately, including quit. Running a
            // nested UI transaction while AppKit tracks a menu can block it.
            tauri::async_runtime::spawn(async move {
                let result = match action.as_str() {
                    "companion.show" => show_companion(app.clone()).await,
                    "companion.hide" => hide_companion(app.clone()).await,
                    "companion.reset" => reset_pet_position(app.clone()).await,
                    "companion.quit" => {
                        app.exit(0);
                        Ok(())
                    }
                    _ => match get_companion_preferences(app.clone()) {
                        Ok(mut preferences) => {
                            match action.as_str() {
                                "companion.size.small" => preferences.scale = 0.8,
                                "companion.size.normal" => preferences.scale = 1.0,
                                "companion.size.large" => preferences.scale = 1.2,
                                "companion.pin" => {
                                    preferences.always_on_top = !preferences.always_on_top
                                }
                                _ => return,
                            }
                            set_companion_preferences(app.clone(), preferences)
                                .await
                                .map(|_| ())
                        }
                        Err(error) => Err(error),
                    },
                };
                if let Err(error) = result {
                    let _ = app.emit("companion:error", &error);
                    eprintln!("Companion menu action failed: {error}");
                }
            });
        })
        .build(app)
        .map_err(|error| format!("创建菜单栏恢复入口失败：{error}"))?;
    #[cfg(target_os = "macos")]
    install_companion_app_menu(app).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_companion_app_menu(app: &AppHandle) -> tauri::Result<()> {
    // Keep the default Edit/Window/Help menus. Only own the application menu:
    // native terminate: re-enters Tao's event-handler mutex when invoked from
    // a tracked context menu. A custom item reaches our deferred app.exit path.
    let menu = Menu::default(app)?;
    menu.remove_at(0)?;
    let hide = MenuItem::with_id(app, "companion.hide", "隐藏橘伴", true, Some("CmdOrCtrl+H"))?;
    let quit = MenuItem::with_id(app, "companion.quit", "退出橘伴", true, Some("CmdOrCtrl+Q"))?;
    let application = Submenu::with_items(
        app,
        "橘伴",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("关于橘伴"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("服务"))?,
            &PredefinedMenuItem::separator(app)?,
            &hide,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    menu.prepend(&application)?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().manage(backend::AgentState::default());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .manage(ChatHitState::default())
        .manage(customization::CustomizationState::default())
        .setup(|app| {
            #[cfg(debug_assertions)]
            motion_diagnostics::install(app.handle());
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let preferences = companion_preferences::load(&preferences_path(app.handle())?)
                .unwrap_or_else(|error| {
                    // Preserve an unreadable preference file. Startup still
                    // exposes the pet and recovery menu with safe defaults.
                    eprintln!("{error}");
                    CompanionPreferences::default()
                });
            app.manage(CompanionPreferencesState::new(preferences));

            for label in ["main", "chat"] {
                if let Some(window) = app.get_webview_window(label) {
                    make_visible_on_every_space(window, true)?;
                }
            }
            if let Some(pet) = app.get_webview_window("main") {
                pet.set_size(LogicalSize::new(PET_CLOSED_WIDTH, PET_CLOSED_HEIGHT))?;
            }
            position_pet_at_bottom_right(app.handle())?;
            apply_companion_preferences(app.handle(), preferences)?;
            install_companion_tray(app.handle())?;
            // Prepare on demand, so startup never moves a restored cat to fit a hidden panel.
            #[cfg(target_os = "macos")]
            if let Ok(panel) = app.get_webview_panel("main") {
                // The window is converted to NSPanel during setup, so its
                // original `visible: true` state is not reliable on relaunch.
                panel.show();
                panel.order_front_regardless();
            }
            // Explicitly hide the empty chat surface so it cannot intercept desktop input.
            if let Some(chat) = app.get_webview_window("chat") {
                chat.hide()?;
            }
            #[cfg(target_os = "macos")]
            {
                update_chat_pointer_policy(app.handle())?;
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_millis(16));
                    let state = handle.state::<ChatHitState>();
                    if !state.visible.load(Ordering::Relaxed)
                        || state.poll_pending.swap(true, Ordering::Relaxed)
                    {
                        continue;
                    }
                    let current = handle.clone();
                    if handle
                        .run_on_main_thread(move || {
                            let _ = update_chat_pointer_policy(&current);
                            current
                                .state::<ChatHitState>()
                                .poll_pending
                                .store(false, Ordering::Relaxed);
                        })
                        .is_err()
                    {
                        break;
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            customization::customization_view,
            customization::customization_asset,
            customization::customization_save_settings,
            customization::customization_use_chat_connection,
            customization::customization_start,
            customization::theme_analysis::customization_theme_prepare,
            customization::theme_analysis::customization_theme_retry,
            customization::theme_analysis::customization_theme_clear,
            customization::customization_retry,
            customization::customization_cancel,
            customization::customization_activate,
            customization::customization_update,
            customization::customization_badge_start,
            customization::customization_badge_cancel,
            customization::customization_delete,
            backend::agent_view,
            backend::save_agent_settings,
            backend::agent_submit,
            backend::agent_list_models,
            backend::agent_list_todos,
            backend::agent_complete_todo,
            backend::agent_reopen_todo,
            backend::agent_set_todo_reminder,
            backend::agent_create_todo,
            backend::agent_update_todo,
            backend::agent_delete_todo,
            backend::agent_list_memos,
            backend::agent_create_memo,
            backend::agent_update_memo,
            backend::agent_archive_memo,
            backend::agent_set_memo_review,
            save_pet_position,
            reset_pet_position,
            quit_app,
            get_companion_preferences,
            set_companion_preferences,
            hide_companion,
            show_companion,
            set_pet_chat_mode,
            set_chat_window_expanded,
            show_chat_window,
            pet_drag_origin,
            move_pet_group,
            set_chat_hit_bounds,
            end_pet_group_drag
        ])
        .run(tauri::generate_context!())
        .expect("error while running desktop AI pet");
}
