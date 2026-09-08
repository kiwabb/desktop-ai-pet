mod agent_protocol;
mod backend;
mod llm;
mod local_agent;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition};

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
    let panel = window
        .to_panel::<DesktopPetPanel>()
        .map_err(|error| format!("将窗口转换为 macOS NSPanel 失败：{error}"))?;

    panel.set_level(PanelLevel::Floating.value());
    let style_mask = if accepts_keyboard_input {
        StyleMask::empty().borderless()
    } else {
        StyleMask::empty().borderless().nonactivating_panel()
    };
    panel.set_style_mask(style_mask.into());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .stationary()
            .ignores_cycle()
            .into(),
    );
    // Finder becomes active again immediately after launching an accessory
    // application. Keep the desktop-pet panel visible across that focus change.
    panel.set_hides_on_deactivate(false);

    Ok(())
}

const WINDOW_EDGE_MARGIN: f64 = 24.0;
const PET_BOTTOM_MARGIN: f64 = 80.0;
const WINDOW_GAP: f64 = 14.0;
const PET_POSITION_FILE: &str = "pet-position.json";
const PET_LEGACY_CLOSED_WIDTH: f64 = 184.0;
const PET_LEGACY_CLOSED_HEIGHT: f64 = 300.0;
// The closed state is the exact right-bottom crop of the compact reference:
// source [1128, 48, 1672, 941] at the standard Retina 2× scale.
const PET_CLOSED_WIDTH: f64 = 232.0;
const PET_CLOSED_HEIGHT: f64 = 380.9;
// The compact state uses the same 1672 × 941 reference canvas as the closed
// cat, uniformly scaled to 0.852941 in CSS. The native surface is therefore
// 713 × 401 logical pixels and the cat keeps the exact closed-state scale.
const PET_CHAT_COMPACT_WIDTH: f64 = 713.0;
const PET_CHAT_COMPACT_HEIGHT: f64 = 401.0;
const PET_CHAT_EXPANDED_WIDTH: f64 = 940.0;
const PET_CHAT_EXPANDED_HEIGHT: f64 = 760.0;
const CHAT_COMPACT_WIDTH: f64 = 360.0;
const CHAT_COMPACT_HEIGHT: f64 = 164.0;
const CHAT_EXPANDED_WIDTH: f64 = 448.0;
const CHAT_EXPANDED_HEIGHT: f64 = 520.0;

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

fn physical_window_pixels(logical_pixels: f64, scale_factor: f64) -> i32 {
    (logical_pixels.ceil() * scale_factor).round() as i32
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
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
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
        let minimum_visible = physical_pixels(64.0, monitor.scale_factor());
        let is_visible = monitors.iter().any(|candidate| {
            let position = candidate.position();
            let size = candidate.size();
            let right = position.x + size.width as i32;
            let bottom = position.y + size.height as i32;
            saved_x < right - minimum_visible
                && saved_x + pet_size.width as i32 > position.x + minimum_visible
                && saved_y < bottom - minimum_visible
                && saved_y + pet_size.height as i32 > position.y + minimum_visible
        });
        if is_visible {
            return pet
                .set_position(PhysicalPosition::new(saved_x, saved_y))
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
fn save_pet_position(app: AppHandle, mut position: StoredPetPosition) -> Result<(), String> {
    let pet = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_owned())?;
    let current_size = pet
        .outer_size()
        .map_err(|error| format!("无法获取桌宠尺寸：{error}"))?;
    position.x += current_size.width as i32;
    position.y += current_size.height as i32;
    position.version = 2;

    let path = pet_position_path(&app)?;
    let directory = path.parent().ok_or_else(|| "桌宠配置目录无效".to_owned())?;
    std::fs::create_dir_all(directory).map_err(|error| format!("创建桌宠配置目录失败：{error}"))?;
    let bytes =
        serde_json::to_vec(&position).map_err(|error| format!("序列化桌宠位置失败：{error}"))?;
    std::fs::write(path, bytes).map_err(|error| format!("保存桌宠位置失败：{error}"))
}

#[tauri::command]
fn reset_pet_position(app: AppHandle) -> Result<(), String> {
    let position = position_pet_at_default(&app)?;

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
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn position_chat_next_to_pet(app: &AppHandle) -> Result<(), String> {
    let pet = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_owned())?;
    let chat = app
        .get_webview_window("chat")
        .ok_or_else(|| "找不到聊天窗口".to_owned())?;
    let monitor = pet
        .current_monitor()
        .map_err(|error| format!("无法获取桌宠所在屏幕：{error}"))?
        .or_else(|| pet.primary_monitor().ok().flatten())
        .ok_or_else(|| "未检测到可用屏幕".to_owned())?;
    let pet_position = pet
        .outer_position()
        .map_err(|error| format!("无法获取桌宠位置：{error}"))?;
    let pet_size = pet
        .outer_size()
        .map_err(|error| format!("无法获取桌宠尺寸：{error}"))?;
    let chat_size = chat
        .outer_size()
        .map_err(|error| format!("无法获取聊天窗口尺寸：{error}"))?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let margin = physical_pixels(WINDOW_EDGE_MARGIN, monitor.scale_factor());
    let bottom_margin = physical_pixels(PET_BOTTOM_MARGIN, monitor.scale_factor());
    let gap = physical_pixels(WINDOW_GAP, monitor.scale_factor());
    let monitor_left = monitor_position.x + margin;
    let monitor_right = monitor_position.x + monitor_size.width as i32 - margin;
    let monitor_top = monitor_position.y + margin;
    let monitor_bottom = monitor_position.y + monitor_size.height as i32 - bottom_margin;

    let left_of_pet = pet_position.x - chat_size.width as i32 - gap;
    let right_of_pet = pet_position.x + pet_size.width as i32 + gap;
    let x = if left_of_pet >= monitor_left {
        left_of_pet
    } else if right_of_pet + chat_size.width as i32 <= monitor_right {
        right_of_pet
    } else {
        monitor_right - chat_size.width as i32
    };
    let y = (monitor_bottom - chat_size.height as i32).max(monitor_top);

    chat.set_position(PhysicalPosition::new(x, y))
        .map_err(|error| format!("无法设置聊天窗口位置：{error}"))
}

fn resize_chat_window(app: &AppHandle, expanded: bool) -> Result<(), String> {
    let chat = app
        .get_webview_window("chat")
        .ok_or_else(|| "找不到聊天窗口".to_owned())?;
    let (width, height) = if expanded {
        (CHAT_EXPANDED_WIDTH, CHAT_EXPANDED_HEIGHT)
    } else {
        (CHAT_COMPACT_WIDTH, CHAT_COMPACT_HEIGHT)
    };
    chat.set_size(LogicalSize::new(width, height))
        .map_err(|error| format!("无法调整聊天窗口尺寸：{error}"))
}

#[tauri::command]
fn set_pet_chat_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let pet = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_owned())?;
    let (width, height) = match mode.as_str() {
        "closed" => (PET_CLOSED_WIDTH, PET_CLOSED_HEIGHT),
        "compact" => (PET_CHAT_COMPACT_WIDTH, PET_CHAT_COMPACT_HEIGHT),
        "expanded" => (PET_CHAT_EXPANDED_WIDTH, PET_CHAT_EXPANDED_HEIGHT),
        _ => return Err(format!("不支持的桌宠对话模式：{mode}")),
    };
    let scale_factor = pet
        .scale_factor()
        .map_err(|error| format!("无法获取窗口缩放比例：{error}"))?;
    let current_position = pet
        .outer_position()
        .map_err(|error| format!("无法获取桌宠位置：{error}"))?;
    let current_size = pet
        .outer_size()
        .map_err(|error| format!("无法获取桌宠尺寸：{error}"))?;
    let anchor_x = current_position.x + current_size.width as i32;
    let anchor_y = current_position.y + current_size.height as i32;
    // AppKit exposes integral point bounds for these borderless panels. The
    // subpixel closed height can therefore receive one transparent backing
    // row; account for that rounding before calculating the shared anchor.
    let next_width = physical_window_pixels(width, scale_factor);
    let next_height = physical_window_pixels(height, scale_factor);

    #[cfg(target_os = "macos")]
    {
        // One atomic AppKit frame update. Do not ask AppKit to display here:
        // WKWebView has not painted the new viewport yet, so display=true
        // presents its stale backing frame and creates a visible flash. React
        // keeps the resize guard mounted until the first new-size paint.
        let primary = pet
            .primary_monitor()
            .map_err(|error| format!("无法获取主屏幕：{error}"))?
            .ok_or_else(|| "未检测到主屏幕".to_owned())?;
        let primary_height_points = primary.size().height as f64 / primary.scale_factor();
        let top_left_x = (anchor_x - next_width) as f64 / scale_factor;
        let top_left_y = (anchor_y - next_height) as f64 / scale_factor;
        let frame = tauri_nspanel::NSRect::new(
            tauri_nspanel::NSPoint::new(top_left_x, primary_height_points - top_left_y - height),
            tauri_nspanel::NSSize::new(width, height),
        );
        let panel = app
            .get_webview_panel("main")
            .map_err(|error| format!("无法获取桌宠面板：{error:?}"))?;
        unsafe {
            let _: () =
                tauri_nspanel::objc2::msg_send![panel.as_panel(), setFrame: frame, display: false];
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        pet.set_size(LogicalSize::new(width, height))
            .map_err(|error| format!("无法调整桌宠对话尺寸：{error}"))?;
        pet.set_position(PhysicalPosition::new(
            anchor_x - next_width,
            anchor_y - next_height,
        ))
        .map_err(|error| format!("无法保持桌宠位置：{error}"))?;
    }

    if mode != "closed" {
        #[cfg(target_os = "macos")]
        {
            let panel = app
                .get_webview_panel("main")
                .map_err(|error| format!("无法获取桌宠面板：{error:?}"))?;
            panel.show_and_make_key();
        }
        #[cfg(not(target_os = "macos"))]
        pet.set_focus()
            .map_err(|error| format!("无法聚焦桌宠对话：{error}"))?;
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn make_visible_on_every_space(
    _window: tauri::WebviewWindow,
    _accepts_keyboard_input: bool,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn show_chat_window(app: AppHandle) -> Result<(), String> {
    resize_chat_window(&app, false)?;
    position_chat_next_to_pet(&app)?;

    #[cfg(target_os = "macos")]
    {
        let panel = app
            .get_webview_panel("chat")
            .map_err(|error| format!("无法获取聊天面板：{error:?}"))?;
        panel.show_and_make_key();
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
        window
            .set_focus()
            .map_err(|error| format!("聚焦聊天窗口失败：{error}"))?;
        Ok(())
    }
}

#[tauri::command]
fn set_chat_window_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    resize_chat_window(&app, expanded)?;
    position_chat_next_to_pet(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().manage(backend::AgentState::default());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            for label in ["main", "chat"] {
                if let Some(window) = app.get_webview_window(label) {
                    make_visible_on_every_space(window, true)?;
                }
            }
            position_pet_at_bottom_right(app.handle())?;
            position_chat_next_to_pet(app.handle())?;
            #[cfg(target_os = "macos")]
            if let Ok(panel) = app.get_webview_panel("main") {
                // The window is converted to NSPanel during setup, so its
                // original `visible: true` state is not reliable on relaunch.
                panel.show();
                panel.order_front_regardless();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend::agent_view,
            backend::save_agent_settings,
            backend::agent_submit,
            backend::agent_list_models,
            backend::agent_list_todos,
            backend::agent_complete_todo,
            backend::agent_reopen_todo,
            backend::agent_set_todo_reminder,
            save_pet_position,
            reset_pet_position,
            quit_app,
            set_pet_chat_mode,
            set_chat_window_expanded,
            show_chat_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running desktop AI pet");
}
