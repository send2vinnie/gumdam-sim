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

Without a key the game runs in demo mode on a flat grid so you can try the controls.

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
* `models/gundam_rx78_18m.glb` flight model (static pose, rifle and shield in hand, faces +X)
* `models/gundam_rx78_pullup_18m.glb` skinned model with the 4 s `PullUp` loop (faces +Z)
* `models/pilot_*.glb` five pilot poses
* `js/app.js` simulator, `config.js` key and locations, `sw.js` + `manifest.webmanifest` app install

## Credits
3D model: "ガンダム（THE ORIGIN版)/Gundam(THE ORIGIN ver)" by みそ太郎 (https://sketchfab.com/nama_140), CC-BY-4.0,
https://sketchfab.com/3d-models/the-origingundamthe-origin-ver-b1fbcc97214a431bbc024f7bc929c41a. Modified (rescaled, posed, animated).
City data © Google and its data providers. CesiumJS © Cesium GS (Apache-2.0).
