import dotenv from 'dotenv'

dotenv.config()

import { cleanEnv, port, str, testOnly } from 'envalid'

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ devDefault: 'development', choices: ['development', 'production', 'test'] }),
  PORT: port({ devDefault: testOnly(3000) }),
  OPENAI_API_KEY: str(),
  DATADOG_API_KEY: str(),
  DATABASE_URL: str(),
  AWS_ACCESS_KEY_ID: str(),
  AWS_SECRET_ACCESS_KEY: str(),
  GOOGLE_MAPS_API_KEY: str(),
  GOOGLE_CLIENT_ID: str(),
  GOOGLE_CLIENT_SECRET: str(),
  GOOGLE_REDIRECT_URI: str(),
  EMBEDDINGS_API_KEY: str(),
  DROPBOX_CLIENT_ID: str(),
  DROPBOX_APP_SECRET: str(),
  DROPBOX_REFRESH_TOKEN: str(),
  DROPBOX_ACCESS_TOKEN: str(),
  GOOGLE_REFRESH_TOKEN: str()
})
