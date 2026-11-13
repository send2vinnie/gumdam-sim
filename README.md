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
  * Nangang start screen: OpenStreetMap building footprints within 1 km of the Exhibition Center, extruded from their
    `height` / `building:levels` (+ `roof:levels`) tags, with `min_height` bases and multipolygon holes
    (`cities/taipei/nangang-osm-v2.geojson`, rebuilt with `node --use-system-ca tools/build_nangang_osm.js [radius_m]`).
    The older 800 m export (`nangang-buildings.geojson`) is kept as a fallback. Overture Maps and other open building
    sets were checked too: for Taiwan they hold no more than OSM (Microsoft's and Google's machine-learned footprints
    don't cover Taiwan), and Taiwan's official 3D models need a citizen-certificate login to download.
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
| Fire | F, left click | RB or X | FIRE |
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

## Characters
Pick one on the start screen (**Character**), remembered between visits.
* **Gundam RX-78-02**, true scale (18.0 m head height).
* **Dragon with rider**: the dragon is shown at a **rideable 4 m** rather than its official 1.7 m. A 1.75 m rider sits astride
  its lower neck, resting on it, with legs wide open around it (checked at build time: the seat touches the neck within 0.5 cm
  and no part of the legs passes through it, even during head turns), leaning
  forward with both hands on its horns; the rider is skinned to the dragon's joints, so the hands stay on
  the horns when the head turns. To use another dragon size, change `DRAGON_HEIGHT_M` in `js/app.js` and rebuild the model with
  `node tools/build_dragon_rider.js <dragon folder> <trainer folder> models/dragon.glb <height>` so the rider stays 1.75 m.

In flight both characters bank into turns, lean with speed and pitch back when climbing / forward when diving, and turn their
heads into the turn (up to 30°). The dragon also beats its wings (slowly when cruising, faster and deeper on boost, folded
when landed) and swings its tail. The chase, far and side cameras and the cockpit / rider's-eye view are sized per character. The chase, far, side and start-screen
cameras stay out of buildings and the ground without turning the view: when a wall, roof or the street is in the way, only the
distance shortens, along the same line, so the look direction stays locked to the character. Five rays (toward the camera
spot and just beside it, checked about 10-14 times a second) give a steady distance at thin edges; the camera eases in within
about 0.15 s, stays in until the way has been clear for half a second, then eases out slowly. Looking up near the ground
brings the camera closer instead of tilting the view.

## Graphics quality: Low
**Low** (the default on phones) draws only what is near: everything beyond **3 km** is not rendered (the city fades into a hazy
sky instead of a hard edge), small props (start-screen pilots, the dragon scene) disappear beyond 450 m, the screen renders at
75 % resolution, city tiles are not requested while the camera moves fast, and projectiles/particle effects are capped lower.
Measured in Shinjuku from 250 m up: draw calls 448 -> 99, city tiles drawn 53 -> 24, city geometry in memory 67 -> 27 MB,
textures 379 -> 204 MB (measured with the earlier 2 km limit). Low is also capped at **30 FPS** (steadier frames, less heat
and battery); a paused game draws at 10 FPS.

Low also uses **half-size city textures**: each Tokyo tile is rewritten in the browser as it arrives (its WebP images scaled
to half width and height, a quarter of the GPU memory), so the stored data stays the same for Medium and High. The tile
memory budget is halved to match (64 MB + 32 MB per area). The start screen shows 5 pilots instead of 12, and the globe
skips its atmosphere tint and uses a coarser ground mesh. Anti-aliasing, HDR and shadows were already off on Low; the sky
fill light stays on, because without it walls facing away from the sun turn black.
Measured with step 2 (software renderer, automatic resolution on): start screen 74 -> 69 ms/frame and draw calls
269 -> 154; Shinjuku at 250 m 140 -> 130 ms/frame, city textures 206 -> 60 MB.

**Choosing Low automatically.** On first launch, phones and weak computers (4 GB memory or less, 2 CPU cores or less, or
a software-only GPU) start on Low. Otherwise the start screen measures the frame rate once (after a 3 s warm-up, over 6 s):
below 20 FPS on Medium, Low is chosen from the next start, with a "Switch now" button. Once you pick a quality in Settings,
your choice is kept. The pause menu shows the frame rate while flying, the current resolution and the quality in use.

On every quality setting:
* **Tokyo areas stream by distance.** Each of the 6 Tokyo areas is opened when the camera comes within the draw distance
  + 1 km of it (Low 4 km, others 7 km) and dropped, freeing its memory, 1.5 km beyond that. The Taipei start screen loads no
  Tokyo tiles at all.
* **Automatic resolution** (Settings, on by default). Every 2 s the game checks the frame rate: below 85 % of the target
  (30 FPS on Low, 50 FPS otherwise) it renders 10 % fewer pixels, down to 50 % (Low) / 60 %; after 6 s at the target it
  goes back up in 5 % steps to the normal scale (75 % on Low, 100 % otherwise).

## Flight difficulty
Choose **Easy / Medium / Hard** on the start screen or in Settings (remembered, applied at once, shown on the HUD). It works the
same with keyboard, gamepad and touch, for both characters.
* **Easy (arcade):** speed follows the stick directly and you stop the moment you let go; no gravity or inertia; direct turns.
* **Medium:** the default feel: some inertia and drag, auto-level, and a gentle sink (2.5 m/s) when you are not climbing.
* **Hard (more physical):** forces per unit mass. The 43.4 t Gundam accelerates slowly (7 m/s² of thrust), the dragon is light
  and nimble (14 m/s²). Drag grows with the square of speed, gravity is 9.81 m/s² against vertical thrust (the Gundam's
  thrusters hold about 98% of its weight at neutral, so it slowly sinks; the dragon's lift comes from airspeed, so it sinks
  when slow, below about 22 m/s). You turn by banking: left/right rolls the body, the turn rate follows the bank angle, and the
  bank stays until you roll back (no auto-level). Boost drains the **BOOST** gauge on the HUD, which recharges when you let go.

## Weapons and destructible buildings
Aim with the crosshair in the middle of the screen and fire (F, left click, gamepad RB/X, or the FIRE button on touch screens).
* **Gundam - beam rifle:** the right arm swings up to aim along the crosshair (the arm and rifle are a separate part pivoted at
  the shoulder), with a recoil kick, a muzzle flash and the head looking at the target. A pink-white beam bolt flies at 600 m/s.
* **Dragon - fireball:** the head rears back with a wing flare, then lunges forward and spits a glowing fireball (80 m/s, with
  a fire trail). The rider keeps both hands on the horns.
* **Every shot explodes.** Each frame a beam or fireball checks the stretch it is about to fly through (and the street
  below it), so it bursts on the first wall, roof or ground it meets, even if the aim ray at firing time missed it (the
  fireball leaves the dragon's mouth, not the camera; tiles may load after firing). A shot that hits nothing bursts in the
  air at the end of its range, and so does the oldest shot when too many are in the air.
* **Hits** explode with fire, smoke, flying debris and a flash. The camera stays still on impacts: no shake by default
  ("Camera shake" in Settings adds a slight nudge on nearby hits, at most about 0.3°, no roll), and firing does not push
  the Gundam back. The camera follows only the body's heading and position, never the arm raise or the head rear-back,
  and the ground and camera-collision checks ignore your own shots, explosions, smoke and debris.
* **Buildings come down:** in the Local city the building you hit disappears in a dust cloud with falling debris (PLATEAU
  buildings in Tokyo and the OSM buildings in Nangang; it stays down when its tiles reload). In Google mode the city is one big
  mesh, so a building-sized hole (about 32 m) is cut out instead, up to 12 at a time; this only changes what is drawn and stores
  nothing from Google. **Pause menu → Rebuild city** puts everything back.
* One aiming ray per shot finds the target, and projectiles and effects are capped, so it stays smooth on phones.

## Scale (verified, not assumed)
* The uploaded model's glTF units are **not** metres: its head top sits at 46.28 units. It was rescaled by 0.38892 so the head
  height is exactly **18.0 m**, the RX-78-02's official head height. Feet sit at the origin.
* Pilots are **1.75 m**. The pull-up bar is **22.07 m** high, sized from the Gundam's measured arm length.
* Google 3D Tiles are real-world metres, and all models load with `scale = 1` and `minimumPixelSize = 0`, so nothing is
  enlarged when you zoom out.
* HUD altitude is shown in metres and in "MS heights" (multiples of 18 m) to make the scale readable.

## Start screen
The start screen is set at Taipei's Nangang Exhibition Center: the Gundam does pull-ups on a steel bar while a crowd of pilots
watches. Beside it, the trainer (1.75 m) trains the dragon (4 m) to jump: the dragon crouches, leaps about 2.6 m with a burst of
wing beats and lands with a small squash, while the trainer points up for each jump and watches.
**Choose your character by clicking or tapping it** (the Gundam, or the dragon / trainer): the choice gets a yellow outline,
a "Selected: ..." label, syncs with the Character menu and is remembered; the camera drifts toward the selected character.
Dragging still turns the camera. The app searches the 3D tiles within 250 m of the configured point for open, level ground so the rig sits on the
plaza rather than a roof. Move it by editing `lobby` in `config.js`.

## Files
* `models/gundam_rx78_18m.glb` flight model (static pose, rifle and shield in hand, faces +X). Its head is a separate node (`head`, pivoted at the neck) so in flight it looks into turns (up to 30°) and up/down with climbs and dives, while the body banks into turns and pitches back when climbing and forward when diving.
* `models/gundam_rx78_pullup_18m.glb` skinned model with the `PullUp` loop (faces +Z): 3 reps in 14.7 s that slow down with fatigue, a pause with the chin over the bar, a slower controlled descent, the upper body leaning back behind the bar as it rises (head over the bar from behind, legs swinging forward to balance), and legs that lag and swing slightly. The fists stay closed around a round bar in one overhand grip the whole time (the finger curl is baked into the mesh, so no extra joints are needed on phones), and the arms are solved every frame so the forearms stay near vertical under the bar while the elbows travel down and out.
* `models/*_med.glb`, `models/*_low.glb` Medium and Low detail versions of both Gundam models
* `models/pilot_*.glb` five pilot poses
* `models/dragon_stand.glb`, `models/trainer_stand.glb` start-screen dragon (wing joints) and trainer (right-arm joint), built by `tools/build_lobby_actors.js`
* `models/dragon.glb` dragon in flight attitude with a 5-joint rig (body, head, wings, tail) and its rider (built by `tools/build_dragon_rider.js`)
* `js/app.js` simulator, `config.js` key and locations, `sw.js` + `manifest.webmanifest` app install

## Credits
3D model: "ガンダム（THE ORIGIN版)/Gundam(THE ORIGIN ver)" by みそ太郎 (https://sketchfab.com/nama_140), CC-BY-4.0,
https://sketchfab.com/3d-models/the-origingundamthe-origin-ver-b1fbcc97214a431bbc024f7bc929c41a. Modified (rescaled, posed, animated).
City data © Google and its data providers. CesiumJS © Cesium GS (Apache-2.0).
Offline Tokyo: 出典：国土交通省 PLATEAU（https://www.mlit.go.jp/plateau/）。3D都市モデル（Project PLATEAU）を加工して作成
(clipped, attributes removed, textures reduced, ground heights derived), used under the PLATEAU site policy (compatible with CC BY 4.0).
Dragon: "charizard" by My Crea Pro (https://sketchfab.com/Beany-Boy), CC-BY-4.0,
https://sketchfab.com/3d-models/charizard-2bfa8441c87347eb84df8e6574eddb86. Modified (posed for flight, rigged, rescaled).
Dragon rider: "Wii - Super Smash Bros Brawl - Pokemon Trainer" by Waffles (https://sketchfab.com/jkimmel694), CC-BY-4.0 as stated
by the uploader, https://sketchfab.com/3d-models/wii-super-smash-bros-brawl-pokemon-trainer-b0fd503839ff41e9ba33eaddc9bc4dae. Modified (posed seated, rescaled).
Pokémon characters are trademarks of Nintendo / Creatures / GAME FREAK / The Pokémon Company; Gundam is a trademark of Sunrise / Bandai Namco. Non-commercial fan project.
Offline Nangang: © OpenStreetMap contributors, Open Database License (ODbL), https://www.openstreetmap.org/copyright.
