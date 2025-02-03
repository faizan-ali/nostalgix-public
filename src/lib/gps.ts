export const isValidCoordinate = (lat: number, lon: number): boolean => {
  return typeof lat === 'number' && typeof lon === 'number' && !Number.isNaN(lat) && !Number.isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}
