export function startCamera(camera) {
  console.log(`[CAM ${camera.id}] Demarre (stub)`);
}
export function stopCamera(cameraId) {
  console.log(`[CAM ${cameraId}] Arrete (stub)`);
}
export function stopAllCameras() {
  console.log('Cameras arretees');
}
export function getCameraState() {
  return { status: 'stopped', recording: false };
}
export function getAllStates() {
  return {};
}