import { Color, UrlTemplateImageryProvider, type Viewer as CesiumViewer } from "cesium";

const APP_BACKGROUND = Color.fromCssColorString("#0A0D14");

/** Token-free XYZ imagery for the base-map selector. */
export function makeBaseImageryProvider(id: string): UrlTemplateImageryProvider {
  if (id === "satellite") {
    return new UrlTemplateImageryProvider({
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      minimumLevel: 0,
      maximumLevel: 19,
    });
  }
  const style = id === "streets" ? "light_all" : "dark_all";
  return new UrlTemplateImageryProvider({
    url: `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png`,
    subdomains: "abcd",
    minimumLevel: 0,
    maximumLevel: 19,
  });
}

/**
 * One-time scene look: space-dark background with no starfield. Cesium leaves
 * skyBox stars on by default; with skyAtmosphere off they read as white noise
 * wherever Ion imagery has not streamed in yet (common after hard refresh).
 */
export function configureCesiumScene(viewer: CesiumViewer): void {
  const { scene } = viewer;
  scene.backgroundColor = APP_BACKGROUND;
  scene.fog.enabled = false;
  if (scene.skyBox) scene.skyBox.show = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  scene.globe.showGroundAtmosphere = false;
  scene.globe.baseColor = APP_BACKGROUND;
  scene.globe.depthTestAgainstTerrain = true;
}
