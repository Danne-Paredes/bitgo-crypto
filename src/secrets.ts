
export const authUrl = 'https://tee.express.magiclabs.com/v1/identity/provider'

const authXSecret = 'sk_live_3A47A29D93C31392'

export const authHeader = {
    "X-Magic-Secret-Key":authXSecret,
    'Content-Type':'application/json'
}

export const authBody = {
  "issuer": "https://accounts.google.com",
  "audience": "1088070671005-gha6blqbls9mdmdlocp0a2l8ljk7atqa.apps.googleusercontent.com",
  "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs"
}

export const addresses: Record<string, string> = {
    'dparedes@knighted.com': "0x9D8Cf6d89E83706e1d3049e25ECC35523FDD63cE",
}