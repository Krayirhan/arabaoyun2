# Ankara map data

`ankara.json` holds what the Ankara free-flight level needs for central
Ankara (Kızılay, Çankaya, Anıtkabir, Atakule):

- building footprints and parts, with courtyards, heights and roof shapes
- roads, parks, forests and water
- a terrain heightmap on a 20 m grid

## Sources and credits

- Buildings, roads and land use: © OpenStreetMap contributors, under the Open
  Database License (ODbL): https://www.openstreetmap.org/copyright
- Terrain: AWS Terrain Tiles (Terrarium format, Mapzen), built from SRTM and
  other public elevation data: https://registry.opendata.aws/terrain-tiles/

The game shows both credits on screen while the Ankara level is active.

## Rebuilding

```
node tools/build-ankara.mjs main.json landmarks.json extra.json terrain/ trees.json
```

All three JSON inputs are Overpass API (`overpass-api.de`) `out geom;`
exports for the bounding box `39.880,32.826,39.932,32.868`:

- `main.json`: `way["building"]`,
  `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"]`,
  `way["leisure"="park"]`
- `landmarks.json`: `nwr["name"~"Anıtkabir|Atakule|Kocatepe Camii|Güvenpark"]`,
  `relation["building"]`
- `extra.json`: `way`/`relation` for `["building:part"]`,
  `["landuse"~"^(grass|forest|meadow|cemetery|recreation_ground|village_green)$"]`,
  `["leisure"~"^(park|garden)$"]` and
  `["natural"~"^(wood|scrub|grassland|water)$"]`
- `trees.json` (optional): `node["natural"="tree"]`, `way["natural"="tree_row"]`

`terrain/` holds zoom 14 Terrarium PNG tiles named `14_<x>_<y>.png`, from
`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/<x>/<y>.png`,
covering lon 32.815–32.880 and lat 39.872–39.940.

## How the data is interpreted

- Underground structures (`layer<0`, `location=underground`) and tunnels are
  skipped. The Kızılay metro station would otherwise cover the intersection.
- An outline with `building:part`s inside is drawn by its parts (Simple 3D
  Buildings). That is how Anıtkabir's colonnade gets its real 22 m columns.
- `building=roof` becomes a thin slab on posts, not a solid block.
- Untagged heights (~85% of buildings) use the median of tagged buildings
  within 150 m, ±1 storey. They are estimates, not survey data.
- Buildings stand on the lowest terrain point under their footprint.
- Facade style comes from the building type (office/hotel → glass, public
  and historic → stone, industrial/schools → plain). Apartments within 15 m
  of a primary/secondary/tertiary road get a shopfront ground floor.
- Trees: the 262 mapped trees and 10 tree rows are placed exactly. On top of
  that the game scatters trees in forests (mostly pine), parks and
  cemeteries, and lines main roads with street trees every ~11 m. Those are
  plausible fills, not surveyed positions.
- Traffic and birds are ambient animation on the real road network, not
  real traffic data.
