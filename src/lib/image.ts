import type { ImageMetadata } from '@/clients/dropbox'
import { isValidCoordinate } from '@/lib/gps'
import ExifReader, { type Tags } from 'exifreader'

export const extractGPSData = (tags: Tags): { latitude?: number; longitude?: number; altitude?: string } => {
  try {
    if (!tags.GPSLatitude?.value || !tags.GPSLongitude?.value || !tags.GPSLatitudeRef?.value || !tags.GPSLongitudeRef?.value) {
      return {}
    }

    // Validate GPS values
    const validGPSValue = (value: any) => Array.isArray(value) && value.length === 3 && value.every(n => n.every((n2: unknown) => Number.isInteger(n2)))

    if (!validGPSValue(tags.GPSLatitude.value) || !validGPSValue(tags.GPSLongitude.value)) {
      console.error('Invalid GPS values:', tags.GPSLatitude.value, tags.GPSLongitude.value)
      return {}
    }

    let latitude = tags.GPSLatitude.description as unknown as number
    let longitude = tags.GPSLongitude.description as unknown as number

    // Apply negative values based on reference
    if ((tags.GPSLatitudeRef.value as string[])[0] === 'S') {
      latitude = -latitude
    }
    if ((tags.GPSLongitudeRef.value as string[])[0] === 'W') {
      longitude = -longitude
    }

    // Validate converted values
    if (!isValidCoordinate(latitude, longitude)) {
      console.error('Invalid GPS coordinates:', latitude, longitude)
      return {}
    }

    return { latitude, longitude, altitude: tags.GPSAltitude?.description }
  } catch (error) {
    console.warn('Error extracting GPS data:', error)
    return {}
  }
}

export const extractMetadata = (buffer: Buffer, path: string, contentHash: string): ImageMetadata & Tags & { isScreenshot: boolean } => {
  try {
    // Validate buffer
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Invalid image buffer')
    }

    const parseExifDate = (str: string): Date | undefined => {
      const split = str.split(/\D/).map(Number)
      return new Date(split[0], split[1] - 1, split[2], split[3], split[4], split[5])
    }

    const tags: Tags = ExifReader.load(buffer)

    const metadata: ImageMetadata = {
      dropboxPath: path,
      size: buffer.length,
      mimeType: `image/${tags.FileType.value}`,
      contentHash
    }

    // Extract location
    const gpsData = extractGPSData(tags)
    if (Object.keys(gpsData).length > 0) metadata.location = gpsData

    // Extract original timestamp
    if (tags.DateTimeOriginal?.description) {
      const timestamp = parseExifDate(tags.DateTimeOriginal.description)
      if (timestamp?.toString() !== 'Invalid Date') {
        metadata.timestamp = timestamp
      }
    }

    // Extract camera info
    if (tags.Make?.description || tags.Model?.description) {
      metadata.deviceInfo = {
        make: tags.Make?.description,
        model: tags.Model?.description
      }
    }

    // @ts-expect-error This is fine
    return { ...metadata, isScreenshot: isLikelyScreenshot(tags), ...tags }
  } catch (e) {
    console.warn(`Error extracting metadata for ${path}:`, { e })
    throw e
  }
}

const isLikelyScreenshot = (tags: Tags): boolean => {
  let isMissingCamera = false
  let isScreenshotColorType = false
  let isUnusualResolution = false

  // Check for missing camera-specific metadata
  const cameraMetadata = ['Make', 'Model', 'ExposureTime', 'ISOSpeedRatings', 'GPSLatitude', 'GPSLongitude']
  const missingMetadata = cameraMetadata.filter(key => !tags[key])

  if (missingMetadata.length === cameraMetadata.length) {
    isMissingCamera = true
    console.log('Exif likely screenshot: Missing camera-specific metadata (make, model, exposure settings, GPS)')
  }

  // Check for standard screenshot color characteristics
  if (tags['Color Type']?.description?.includes('RGB with Alpha')) {
    isScreenshotColorType = true
    console.log('Exif likely screenshot: Uses RGB with Alpha color space, typical for screenshots')
  }

  // Check for standard photo resolutions
  // Common photo resolutions often come in standard sizes or ratios
  const width = Number(tags['Image Width']?.value || 0)
  const height = Number(tags['Image Height']?.value || 0)

  if (!width || !height) isUnusualResolution = true
  else {
    // Common aspect ratios for smartphone cameras (with some tolerance)
    const aspectRatio = width / height
    const commonAspectRatios = [
      4 / 3, // Standard camera aspect
      16 / 9, // Widescreen
      3 / 2, // Classic DSLR
      1 // Square
    ]

    // Common megapixel ranges for modern smartphone cameras
    const megapixels = (width * height) / 1000000
    const isCommonMegapixels = megapixels >= 8 && megapixels <= 108 // Range from basic smartphones to high-end

    // Check if the aspect ratio matches common photo ratios (with 5% tolerance)
    const hasStandardAspectRatio = commonAspectRatios.some(ratio => {
      const tolerance = 0.05
      return Math.abs(aspectRatio - ratio) <= tolerance
    })

    // Resolution patterns that suggest screenshots
    isUnusualResolution =
      // Odd specific numbers (like 639x495) often indicate screenshots
      (width % 100 !== 0 && height % 100 !== 0) ||
      // Very low resolution for modern devices
      megapixels < 2 ||
      // Uncommon aspect ratio and non-standard megapixels
      (!hasStandardAspectRatio && !isCommonMegapixels)
  }

  if (isUnusualResolution) {
    console.log(`Exif likely screenshot: Non-standard photo resolution: ${width}x${height}`)
  }

  return isMissingCamera && isScreenshotColorType && isUnusualResolution
}

export const getExtensionFromFile = (filename: string): string => {
  const parts = filename.split('.')
  return parts[parts.length - 1]
}
