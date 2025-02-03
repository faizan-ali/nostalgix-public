import sharp from 'sharp'

const createOverlayText = (title: string, subtitle?: string) => {
  const titleWidth = title.length * 44
  const subtitleWidth = subtitle ? subtitle.length * 36 : 0
  const contentWidth = Math.max(titleWidth, subtitleWidth)
  const padding = 240
  const width = contentWidth + padding
  const leftPadding = 140

  // Calculate y-position based on whether subtitle exists
  const titleY = subtitle ? '88' : '100'

  return `
<svg width="${width}" height="200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.25"/>
    </filter>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:rgba(0,0,0,0.5)"/>
      <stop offset="100%" style="stop-color:rgba(0,0,0,0.3)"/>
    </linearGradient>
  </defs>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@500;400&amp;display=swap');
    .background { fill: url(#bgGradient); }
    .title { 
      fill: #ffffff; 
      font-family: 'Montserrat', sans-serif;
      font-size: 64px; // Doubled again from 32px
      font-weight: 500;
      letter-spacing: 0.5px;
      filter: url(#shadow);
    }
    .subtitle { 
      fill: rgba(255,255,255,0.8); 
      font-family: 'Montserrat', sans-serif;
      font-size: 56px; // Doubled again from 28px
      font-weight: 400;
      letter-spacing: 0.3px;
      filter: url(#shadow);
      opacity: 0.9;
    }
  </style>
  <rect class="background" x="0" y="0" width="${width}" height="200" opacity="0.85"/>
  <text x="${leftPadding}" y="${titleY}" dominant-baseline="middle" class="title">
    ${title}
  </text>
  ${
    subtitle
      ? `
  <text x="${leftPadding}" y="152" dominant-baseline="middle" class="subtitle">
    ${subtitle}
  </text>
  `
      : ''
  }
</svg>
`
}

export const addOverlay = async (image: Buffer, title: string, subtitle: string): Promise<Buffer> => {
  const sharped = sharp(image).keepExif()
  const metadata = await sharped.metadata()
  
  // Get dimensions considering orientation
  const isRotated = metadata.orientation === 6 // 6 is "right-top" orientation from older Android phones
  const imageWidth = metadata.width || 800
  const imageHeight = metadata.height || 450

  // Calculate SVG position
  const svgHeight = 200 // Match the SVG height
  const left = isRotated 
    ? imageWidth - svgHeight - 20  // For rotated images, measure from right edge
    : 20 // For normal images, 20px from left
  const top = isRotated 
    ? 20  // For rotated images, measure from the top
    : imageHeight - svgHeight - 20 // For normal images, measure from bottom

  if (!title || title === 'null' || title === 'undefined') {
    title = subtitle!
    subtitle = undefined!
  }

  const overlayBuffer = Buffer.from(createOverlayText(title, subtitle))

  // If rotated, process the SVG overlay first. This places the SVG on the bottom right rather than bottom left and I can't be bothered to solve
  const processedOverlay = isRotated
    ? await sharp(overlayBuffer).rotate(-90).toBuffer()
    : overlayBuffer

  return sharped
    .composite([
      {
        input: processedOverlay,
        top,
        left
      }
    ])
    .toBuffer()
}
