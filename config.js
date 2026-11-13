// Simulator configuration.
// Put your Google Maps Platform API key here (Map Tiles API must be enabled),
// or leave it empty and enter the key in the in-game Settings dialog instead.
window.SIM_CONFIG = {
  googleMapsApiKey: "",

  // Start screen ("game hall") location: Taipei Nangang Exhibition Center, Hall 1.
  // The app searches within ~250 m of this point for open, flat ground (a plaza)
  // so the pull-up rig never ends up on a roof or inside a building.
  lobby: { lat: 25.0556, lon: 121.6176, searchRadius: 250, heading: 0 },

  // Tokyo starting points (heading = compass direction the Gundam faces, degrees).
  spawns: [
    { name: "Nishi-Shinjuku skyscraper district", lat: 35.6886, lon: 139.6930, heading: 45,  alt: 160 },
    { name: "Shibuya Crossing",                    lat: 35.6590, lon: 139.6995, heading: 20,  alt: 90 },
    { name: "Tokyo Tower (333 m)",                 lat: 35.6528, lon: 139.7400, heading: 35,  alt: 120 },
    { name: "Tokyo Station / Marunouchi",          lat: 35.6795, lon: 139.7640, heading: 30,  alt: 120 },
    { name: "Tokyo Skytree (634 m)",               lat: 35.7040, lon: 139.8050, heading: 40,  alt: 250 },
    { name: "Odaiba waterfront",                   lat: 35.6210, lon: 139.7700, heading: 340, alt: 80 }
  ]
};
