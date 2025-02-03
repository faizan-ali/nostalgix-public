import * as fs from 'node:fs'
import * as path from 'node:path'
import { env } from '@/lib/env'
import dotenv from 'dotenv'
import { OAuth2Client } from 'google-auth-library'
import fetch from 'node-fetch'

dotenv.config()

interface PhotoItem {
  id: string
  baseUrl: string
  filename: string
  mimeType: string
}

export class GooglePhotos {
  private oauth2Client: OAuth2Client

  constructor() {
    this.oauth2Client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI)

    this.oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    })
  }

  async fetchPhotos(pageSize = 50): Promise<PhotoItem[]> {
    try {
      const accessToken = (await this.oauth2Client.getAccessToken()).token
      if (!accessToken) throw new Error('Failed to get access token')

      const response = await fetch(`https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=${pageSize}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      return data as PhotoItem[]
    } catch (error) {
      console.error('Error fetching photos:', error)
      throw error
    }
  }

  async downloadPhoto(photoItem: PhotoItem, downloadDir: string): Promise<void> {
    try {
      const response = await fetch(`${photoItem.baseUrl}=d`)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const buffer = await response.arrayBuffer()
      const filePath = path.join(downloadDir, photoItem.filename)
      fs.writeFileSync(filePath, Buffer.from(buffer))

      console.log(`Downloaded: ${photoItem.filename}`)
    } catch (error) {
      console.error(`Error downloading ${photoItem.filename}:`, error)
    }
  }
}
