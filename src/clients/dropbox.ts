import { wait } from '@/lib/async'
import { env } from '@/lib/env'
import { getExtensionFromFile } from '@/lib/image'
import { Dropbox } from 'dropbox'
import type { files } from 'dropbox'
import fetch from 'node-fetch'
type FileMetadataReference = files.FileMetadataReference
type FileMetadata = files.FileMetadata

export interface ImageMetadata {
  dropboxPath: string
  size: number
  mimeType: string
  contentHash: string
  location?: {
    latitude?: number
    longitude?: number
    altitude?: string
  }
  timestamp?: Date
  deviceInfo?: {
    make?: string
    model?: string
  }
}

type ListImageOptions = {
  limit?: number
  date?: Date
}

export type DownloadedImage = {
  buffer: Buffer
  dropboxMeta: FileMetadataReference
  base64: string
  fileType: string
}

export class DropboxClient {
  private dropbox: Dropbox
  private rateLimiter: { lastRequest: Date; minDelay: number }
  private tokens = {
    accessToken: env.DROPBOX_ACCESS_TOKEN,
    refreshToken: env.DROPBOX_REFRESH_TOKEN,
    expiresAt: undefined as Date | undefined
  }

  // Min 200ms between requests
  constructor() {
    this.dropbox = new Dropbox({
      accessToken: this.tokens.accessToken,
      refreshToken: this.tokens.refreshToken,
      fetch
    })
    this.rateLimiter = { lastRequest: new Date(0), minDelay: 200 }
  }

  private async enforceRateLimit(): Promise<void> {
    const now = new Date()
    const timeSinceLastRequest = now.getTime() - this.rateLimiter.lastRequest.getTime()

    if (timeSinceLastRequest < this.rateLimiter.minDelay) {
      await wait(this.rateLimiter.minDelay - timeSinceLastRequest)
    }

    this.rateLimiter.lastRequest = new Date()
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.tokens.expiresAt || this.tokens.expiresAt.getTime() - Date.now() < 300000) {
      // 5 min buffer
      await this.refreshAccessToken()
    }
  }

  private async retryOperation<T>(operation: () => Promise<T>, maxRetries = 3, initialDelay = 1000): Promise<T> {
    let lastError: any
    let delay = initialDelay

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error: any) {
        lastError = error

        // Check if it's a rate limit error
        if (error?.status === 429) {
          const retryAfter = Number.parseInt(error.headers?.['retry-after'] || '60', 10)
          delay = retryAfter * 1000
        } else {
          // Exponential backoff for other errors
          delay *= 2
        }

        // Don't retry on certain errors
        if (error?.status === 409 || error?.status === 401) {
          throw error
        }

        // Last attempt, throw the error
        if (attempt === maxRetries) {
          throw error
        }

        await wait(delay)
      }
    }

    console.error(`All attempts to Dropbox failed with error: ${lastError.error} ${lastError.message}...`, { lastError })
    throw lastError
  }

  private async refreshAccessToken(): Promise<void> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken,
      client_id: env.DROPBOX_CLIENT_ID,
      client_secret: env.DROPBOX_APP_SECRET
    })

    const response = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      body: params
    })

    if (!response.ok) {
      console.error(`Failed to refresh token: ${response.status} ${response.statusText} ${await response.text()}`)
      throw new Error('Failed to refresh token')
    }

    const data = (await response.json()) as any
    this.tokens.accessToken = data.access_token
    this.tokens.expiresAt = new Date(Date.now() + data.expires_in * 1000)

    // Update Dropbox client with new token
    this.dropbox = new Dropbox({ accessToken: this.tokens.accessToken, fetch })
  }

  async listImages(folderPath: string, exclusions: string[], { limit, date }: ListImageOptions): Promise<FileMetadataReference[]> {
    await this.ensureValidToken()

    try {
      let allImages: FileMetadataReference[] = []
      let hasMore = true
      let cursor: string | undefined

      // Pre-calculate date range if needed
      const dateRange = date
        ? {
            start: new Date(date.setHours(0, 0, 0, 0)),
            end: new Date(date.setHours(23, 59, 59, 999))
          }
        : null

      while (hasMore && (!limit || allImages.length < limit)) {
        await this.enforceRateLimit()

        try {
          const response = await this.retryOperation(async () => {
            if (cursor) {
              return await this.dropbox.filesListFolderContinue({ cursor })
            } else {
              return await this.dropbox.filesListFolder({
                path: folderPath,
                recursive: true,
                limit: 2000, // Increased from 1000
                include_media_info: true
              })
            }
          })

          // Parallel filtering of entries
          const filteredImages = await Promise.all(
            response.result.entries
              .map(entry => {
                const isImage = entry['.tag'] === 'file' && /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(entry.path_lower || '')
                if (!isImage) return null
                if (!dateRange) return entry

                const modifiedDate = new Date(entry.server_modified)
                return modifiedDate >= dateRange.start && modifiedDate <= dateRange.end ? entry : null
              })
              .filter(Boolean)
              .filter(entry => !exclusions.some(ignoreName => entry?.name === ignoreName.toLowerCase()))
          )

          const images = filteredImages.filter((entry): entry is FileMetadataReference => entry !== null)

          // Early termination if we have enough images
          if (limit) {
            const remaining = limit - allImages.length
            images.length = Math.min(images.length, remaining)
            allImages = allImages.concat(images)
            if (allImages.length >= limit) break
          } else {
            allImages = allImages.concat(images)
          }

          hasMore = response.result.has_more
          cursor = response.result.cursor

          const dateStr = date ? ` for ${date.toISOString().split('T')[0]}` : ''
          const limitStr = limit ? `/${limit}` : ''
          console.log(`Retrieved ${images.length} images${dateStr} (total: ${allImages.length}${limitStr})`)
        } catch (error: any) {
          if (error?.status === 409 && error?.error?.error?.['.tag'] === 'path_not_found') {
            throw new Error(`Folder not found: ${folderPath}`)
          }
          throw error
        }
      }

      return allImages
    } catch (error) {
      console.error('Error listing images:', error)
      throw error
    }
  }

  async downloadFile(image: FileMetadataReference): Promise<Buffer> {
    await this.enforceRateLimit()

    try {
      const response = await this.retryOperation(() => this.dropbox.filesDownload({ path: image.path_lower! }))
      const buffer: Buffer = (response.result as any).fileBinary

      if (!buffer || buffer.length === 0) {
        throw new Error('Empty file buffer received')
      }

      // Verify content hash
      if (response.result.content_hash !== image.content_hash) {
        throw new Error('Content hash mismatch - file may be corrupted')
      }

      return buffer
    } catch (error: any) {
      throw new Error(`Failed to process ${image.path_lower}: ${error.message}`)
    }
  }

  async downloadImages(folderPath: string, fileNamesToFilter: string[], options: ListImageOptions): Promise<Array<DownloadedImage>> {
    const downloaded: Array<DownloadedImage> = []

    try {
      console.log('Listing images...')
      const images: FileMetadataReference[] = await this.listImages(folderPath, fileNamesToFilter, options)

      // Filter out ignored files
      const filteredImages = images.filter(image => !fileNamesToFilter.some(ignoreName => image.name.toLowerCase() === ignoreName.toLowerCase()))
      console.log(`Filtered out ${images.length - filteredImages.length} ignored files`)

      // Increased batch size and concurrent downloads
      const batchSize = 20 // Increased from 10
      const maxConcurrent = 5 // Maximum concurrent downloads within a batch

      for (let i = 0; i < filteredImages.length; i += batchSize) {
        const batch: FileMetadataReference[] = filteredImages.slice(i, i + batchSize)
        const currentBatch = Math.floor(i / batchSize) + 1
        const totalBatches = Math.ceil(filteredImages.length / batchSize)
        console.log(`Downloading batch ${currentBatch} of ${totalBatches}`)

        // Process batch in chunks of maxConcurrent
        for (let j = 0; j < batch.length; j += maxConcurrent) {
          const chunk: FileMetadataReference[] = batch.slice(j, j + maxConcurrent)
          const chunkPromises = chunk.map(async (image: FileMetadataReference) => {
            try {
              const buffer = await this.downloadFile(image)
              downloaded.push({
                buffer,
                dropboxMeta: image,
                base64: buffer.toString('base64'),
                fileType: getExtensionFromFile(image.name)
              })
              console.log(`Successfully downloaded: ${image.name}`)
            } catch (error: any) {
              console.error(`Failed to download ${image.name}:`, error.message)
            }
          })

          await Promise.all(chunkPromises)
        }

        // Add shorter delay between batches
        await wait(500) // Reduced from 1000ms

        const progress = (((i + batch.length) / filteredImages.length) * 100).toFixed(2)
        console.log(`Progress: ${progress}% (${i + batch.length}/${filteredImages.length})`)
      }

      return downloaded
    } catch (error: any) {
      console.error('Fatal error during processing:', error)
      throw error
    }
  }

  async uploadFile(buffer: Buffer, dropboxPath: string): Promise<FileMetadata> {
    await this.ensureValidToken()
    await this.enforceRateLimit()

    try {
      const response = await this.retryOperation(() =>
        this.dropbox.filesUpload({
          path: dropboxPath,
          contents: buffer,
          mode: { '.tag': 'overwrite' },
          strict_conflict: false
        })
      )

      return response.result
    } catch (error: any) {
      console.error(`Failed to upload to ${dropboxPath}:`, {
        error: {
          error: error.error.error,
          summary: error.error_summary
        }
      })
      throw new Error(`Failed to upload to ${dropboxPath}: ${error.message}`)
    }
  }

  async uploadFiles(files: Array<{ buffer: Buffer; path: string }>): Promise<
    Array<{
      path: string
      metadata: FileMetadata
    }>
  > {
    const uploaded: Array<{ path: string; metadata: FileMetadata }> = []

    try {
      // Process in batches
      const batchSize = 10 // Upload 10 files at a time
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        const currentBatch = Math.floor(i / batchSize) + 1
        const totalBatches = Math.ceil(files.length / batchSize)
        console.log(`Processing upload batch ${currentBatch} of ${totalBatches}`)

        const batchPromises = batch.map(async ({ buffer, path }) => {
          try {
            const metadata = await this.uploadFile(buffer, path)
            uploaded.push({ path, metadata })
            console.log(`Successfully uploaded: ${path}`)
          } catch (error: any) {
            console.error(`Failed to upload ${path}:`, error.message)
          }
        })

        // Wait for current batch to complete
        await Promise.all(batchPromises)

        // Add delay between batches
        await wait(1000)

        // Log progress
        const progress = (((i + batch.length) / files.length) * 100).toFixed(2)
        console.log(`Upload progress: ${progress}% (${i + batch.length}/${files.length})`)
      }

      return uploaded
    } catch (error: any) {
      console.error('Fatal error during upload:', error)
      throw error
    }
  }
}
