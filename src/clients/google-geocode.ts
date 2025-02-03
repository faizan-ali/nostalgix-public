import { Client, type GeocodeResult, type Status } from '@googlemaps/google-maps-services-js'

class GeocodingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: Status
  ) {
    super(message)
    this.name = 'GeocodingError'
  }
}

interface Location {
  address: string
  city: string
  state: string
  country: string
  postalCode: string
  neighborhood?: string
  sublocality?: string
}

interface Coordinates {
  lat: number
  lng: number
}

export class GeocodingService {
  private client: Client
  private requestCount = 0
  private lastRequestTime = 0
  private readonly RATE_LIMIT = 50 // Queries per second
  private readonly RATE_LIMIT_WINDOW = 1000 // 1 second in ms

  constructor(private readonly apiKey: string) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new GeocodingError('API key is required', 'INVALID_API_KEY')
    }
    this.client = new Client({})
  }

  private validateCoordinates(lat: number, lng: number): void {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new GeocodingError('Latitude and longitude must be numbers', 'INVALID_COORDINATES')
    }
    if (lat < -90 || lat > 90) {
      throw new GeocodingError('Latitude must be between -90 and 90 degrees', 'INVALID_LATITUDE')
    }
    if (lng < -180 || lng > 180) {
      throw new GeocodingError('Longitude must be between -180 and 180 degrees', 'INVALID_LONGITUDE')
    }
  }

  private validateAddress(address: string): void {
    if (!address || typeof address !== 'string') {
      throw new GeocodingError('Address must be a non-empty string', 'INVALID_ADDRESS')
    }
    if (address.trim().length === 0) {
      throw new GeocodingError('Address cannot be empty or only whitespace', 'EMPTY_ADDRESS')
    }
  }

  private async checkRateLimit(): Promise<void> {
    const now = Date.now()
    if (now - this.lastRequestTime < this.RATE_LIMIT_WINDOW) {
      if (this.requestCount >= this.RATE_LIMIT) {
        const delay = this.RATE_LIMIT_WINDOW - (now - this.lastRequestTime)
        await new Promise(resolve => setTimeout(resolve, delay))
        this.requestCount = 0
      }
    } else {
      this.requestCount = 0
    }
    this.requestCount++
    this.lastRequestTime = now
  }

  private parseAddressComponents(components: GeocodeResult['address_components'], isUSA: boolean): Location {
    const location: Location = {
      address: '',
      city: '',
      state: '',
      country: '',
      postalCode: '',
      neighborhood: '',
      sublocality: ''
    }

    if (!Array.isArray(components)) {
      throw new GeocodingError('Invalid address components received from API', 'INVALID_RESPONSE')
    }

    for (const component of components) {
      if (!component.types || !Array.isArray(component.types)) continue

      // Placate the compiler
      const types = component.types as string[]
      const name = component.long_name

      // City level
      if (types.includes('locality') || types.includes('postal_town') || types.includes('sublocality_level_1')) {
        location.city = location.city || name
      }

      // Sublocality/district
      if (types.includes('sublocality') || types.includes('sublocality_level_1') || types.includes('sublocality_level_2')) {
        location.sublocality = location.sublocality || name
      }

      // Neighborhood
      if (types.includes('neighborhood') || types.includes('sublocality_level_3') || types.includes('sublocality_level_4') || types.includes('sublocality_level_5') || types.includes('administrative_area_level_2')) {
        location.neighborhood = location.neighborhood || name
      }

      // State/Province level
      if (types.includes('administrative_area_level_1')) {
        location.state = isUSA ? component.short_name : name
      }

      // State/Province level 2
      if (types.includes('administrative_area_level_2')) {
        location.state = location.state || name
      }

      // Country
      if (types.includes('country')) {
        location.country = name
      }

      // Postal code
      if (types.includes('postal_code')) {
        location.postalCode = name
      }
    }

    return location
  }

  private handleApiError(status: Status): never {
    const errorMessages: Record<Status, string> = {
      OK: 'No error occurred',
      ZERO_RESULTS: 'No results found for the given location',
      OVER_QUERY_LIMIT: 'Query quota exceeded for the API key',
      OVER_DAILY_LIMIT: 'Daily quota exceeded for the API key',
      REQUEST_DENIED: 'Request was denied by the API',
      INVALID_REQUEST: 'Request was invalid',
      UNKNOWN_ERROR: 'Server error occurred',
      MAX_ROUTE_LENGTH_EXCEEDED: 'Maximum route length exceeded',
      MAX_WAYPOINTS_EXCEEDED: 'Maximum waypoints exceeded',
      NOT_FOUND: 'Location not found'
    }

    throw new GeocodingError(errorMessages[status] || 'Unknown API error occurred', 'API_ERROR', status)
  }

  async reverseGeocode(latitude: number, longitude: number): Promise<Location> {
    try {
      this.validateCoordinates(latitude, longitude)
      await this.checkRateLimit()

      const response = await this.client.reverseGeocode({
        params: {
          latlng: { lat: latitude, lng: longitude },
          key: this.apiKey
        },
        timeout: 5000 // 5 second timeout
      })

      if (response.data.status !== 'OK') {
        this.handleApiError(response.data.status)
      }

      if (!response.data.results || !response.data.results[0]) {
        throw new GeocodingError('No results found', 'NO_RESULTS')
      }

      const result = response.data.results[0]
      const location = this.parseAddressComponents(result.address_components, result.formatted_address.includes('USA'))
      location.address = result.formatted_address

      // Fallback for city if not found
      if (!location.city && location.sublocality) {
        location.city = location.sublocality
      }

      // Remove empty optional fields
      Object.keys(location).forEach(key => {
        if (!location[key as keyof Location]) {
          delete location[key as keyof Location]
        }
      })

      return location
    } catch (error) {
      if (error instanceof GeocodingError) {
        throw error
      }

      // Handle network errors
      if (error.code === 'ECONNABORTED') {
        throw new GeocodingError('Request timed out', 'TIMEOUT')
      }

      if (error.code === 'ENOTFOUND') {
        throw new GeocodingError('Network connection error', 'NETWORK_ERROR')
      }

      throw new GeocodingError('An unexpected error occurred', 'UNKNOWN_ERROR')
    }
  }

  async geocode(address: string): Promise<Coordinates> {
    try {
      this.validateAddress(address)
      await this.checkRateLimit()

      const response = await this.client.geocode({
        params: {
          address,
          key: this.apiKey
        },
        timeout: 5000 // 5 second timeout
      })

      if (response.data.status !== 'OK') {
        this.handleApiError(response.data.status)
      }

      if (!response.data.results || !response.data.results[0]) {
        throw new GeocodingError('No results found', 'NO_RESULTS')
      }

      const location = response.data.results[0].geometry.location

      if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
        throw new GeocodingError('Invalid coordinates received from API', 'INVALID_RESPONSE')
      }

      return {
        lat: location.lat,
        lng: location.lng
      }
    } catch (error) {
      if (error instanceof GeocodingError) {
        throw error
      }

      if (error.code === 'ECONNABORTED') {
        throw new GeocodingError('Request timed out', 'TIMEOUT')
      }

      if (error.code === 'ENOTFOUND') {
        throw new GeocodingError('Network connection error', 'NETWORK_ERROR')
      }

      throw new GeocodingError('An unexpected error occurred', 'UNKNOWN_ERROR')
    }
  }
}
