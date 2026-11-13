# Gundam Flight Simulator (Tokyo)

A browser-based flight simulator: pilot the RX-78-02 (THE ORIGIN ver.) over and between Tokyo's real skyscrapers,
streamed from Google Photorealistic 3D Tiles (the same 3D city data as Google Earth) and rendered with CesiumJS.
It runs in Chrome or Edge on **Windows** and Chrome on **Android**, and can be installed as an app on both.

## 1. Get a Google Maps Platform API key (required for the real city)
1. In Google Cloud Console, create a project and enable billing (Map Tiles API has a free monthly allowance).
2. Enable **Map Tiles API**.
3. Create an API key. Restrict it to *Map Tiles API* and to your site's address
   (for example `http://localhost:8080/*` and `https://<you>.github.io/*`).
4. Paste it into `config.js` (`googleMapsApiKey`) or into the in-game **Settings** dialog.

Without a key the game uses its built-in **offline city** (see below), so you can play right away.

## City source: Local (offline) or Google
Choose it in **Settings → City source** (applies after *Save & reload*). The default is **Local**, even when a Google key is saved; Google is used only if you pick it here.

* **Local (offline): PLATEAU Tokyo + OSM Nangang.** Stored with the game, no key or account needed, and cached on the device
  as you visit areas, so they also work offline afterwards.
  * Tokyo: the Japanese government's open 3D city model [Project PLATEAU](https://www.mlit.go.jp/plateau/) (MLIT, 2025, LOD2
    buildings with photo textures where PLATEAU has them). About 1.5 km around each starting point: Nishi-Shinjuku, Shibuya,
    Tokyo Tower, Tokyo Station / Marunouchi, Skytree and Odaiba (`cities/tokyo/<ward>/tileset.json`, 653 MB in total).
    Tiles were clipped to those areas, the building attribute tables were removed and texture atlases were reduced to
    1024 px. The ground under the buildings is built from each building's surveyed base height (`cities/tokyo/ground/`).
  * Nangang start screen: OpenStreetMap building footprints within 800 m, extruded from their `height` / `building:levels`
    tags (`cities/taipei/nangang-buildings.geojson`).
* **Google Photorealistic (online, needs API key).** Photo-real everywhere, streamed from Google. It cannot be stored
  offline: Google's terms don't allow downloading or caching the tiles.

## 2. Run it
* **Windows (local):** double-click `start-windows.bat`. It serves the folder at http://localhost:8080 and opens your browser.
* **Android / anywhere:** host the folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages) and open the URL
  in Chrome. Use *Add to Home screen / Install app* for a full-screen app. HTTPS is required for installing and for gamepads.

## 3. Controls
| | Keyboard + mouse | Gamepad | Touch |
|---|---|---|---|
| Forward / back | W / S, ↑ / ↓ | Left stick up/down | Left stick up/down |
| Turn | A / D, ← / → | Right stick left/right | Left stick left/right |
| Strafe | Q / E | Left stick left/right | Right stick left/right |
| Up / down | Space / C | RT / LT | Right stick up/down |
| Boost | Shift | A (hold) | BOOST (hold) |
| Camera | V, mouse drag, wheel | Y, right stick up/down | ◎, drag empty screen |
| Pause | Esc | Start | ☰ |

## 4. Settings: 3D detail
Open **Settings** from the start screen or the pause menu. The two detail options apply immediately, without reloading:
* **City detail** (Very low, Low, Medium, High, Ultra) sets how sharp Google's 3D buildings are. Higher looks better but uses
  more memory and data. The default is Low on phones and tablets, Very low on phones with 4 GB of memory or less, and Medium
  on computers.
* **Gundam model detail** (Low, Medium, High) swaps the mobile suit between three versions. High is the original model.
  Medium and Low have fewer polygons and smaller textures, so they load and draw faster on phones. The default is Medium on
  phones and tablets, and High on computers.

The pause menu and Settings show the current levels, for example "Gundam: Medium · City: Low". **Graphics quality** still
sets the defaults the first time the game runs, and still needs *Save & reload*.

## Scale (verified, not assumed)
* The uploaded model's glTF units are **not** metres: its head top sits at 46.28 units. It was rescaled by 0.38892 so the head
  height is exactly **18.0 m**, the RX-78-02's official head height. Feet sit at the origin.
* Pilots are **1.75 m**. The pull-up bar is **22.07 m** high, sized from the Gundam's measured arm length.
* Google 3D Tiles are real-world metres, and all models load with `scale = 1` and `minimumPixelSize = 0`, so nothing is
  enlarged when you zoom out.
* HUD altitude is shown in metres and in "MS heights" (multiples of 18 m) to make the scale readable.

## Start screen
The start screen is set at Taipei's Nangang Exhibition Center: the Gundam does pull-ups on a steel bar while a crowd of pilots
watches. The app searches the 3D tiles within 250 m of the configured point for open, level ground so the rig sits on the
plaza rather than a roof. Move it by editing `lobby` in `config.js`.

## Files
* `models/gundam_rx78_18m.glb` flight model (static pose, rifle and shield in hand, faces +X). Its head is a separate node (`head`, pivoted at the neck) so in flight it looks into turns (up to 30°) and up/down with climbs and dives, while the body banks into turns and pitches back when climbing and forward when diving.
* `models/gundam_rx78_pullup_18m.glb` skinned model with the `PullUp` loop (faces +Z): 3 reps in 14.7 s that slow down with fatigue, a pause with the chin over the bar, a slower controlled descent, the upper body leaning back behind the bar as it rises (head over the bar from behind, legs swinging forward to balance), and legs that lag and swing slightly. The fists stay closed around a round bar in one overhand grip the whole time (the finger curl is baked into the mesh, so no extra joints are needed on phones), and the arms are solved every frame so the forearms stay near vertical under the bar while the elbows travel down and out.
* `models/*_med.glb`, `models/*_low.glb` Medium and Low detail versions of both Gundam models
* `models/pilot_*.glb` five pilot poses
* `js/app.js` simulator, `config.js` key and locations, `sw.js` + `manifest.webmanifest` app install

## Credits
3D model: "ガンダム（THE ORIGIN版)/Gundam(THE ORIGIN ver)" by みそ太郎 (https://sketchfab.com/nama_140), CC-BY-4.0,
https://sketchfab.com/3d-models/the-origingundamthe-origin-ver-b1fbcc97214a431bbc024f7bc929c41a. Modified (rescaled, posed, animated).
City data © Google and its data providers. CesiumJS © Cesium GS (Apache-2.0).
Offline Tokyo: 出典：国土交通省 PLATEAU（https://www.mlit.go.jp/plateau/）。3D都市モデル（Project PLATEAU）を加工して作成
(clipped, attributes removed, textures reduced, ground heights derived), used under the PLATEAU site policy (compatible with CC BY 4.0).
Offline Nangang: © OpenStreetMap contributors, Open Database License (ODbL), https://www.openstreetmap.org/copyright.
