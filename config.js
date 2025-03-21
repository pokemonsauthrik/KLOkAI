module.exports = {
  THREADS: 20,
  BASE_URL: "https://api1-pp.klokapp.ai/v1",

  GROQ_API_KEY_PATH: "./groq-api.key",

  GROQ_MODEL: "mixtral-8x7b-32768",

  DEFAULT_HEADERS: {
    "content-type": "application/json",
    Origin: "https://klokapp.ai",
    Referer: "https://klokapp.ai/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  },

  REFERRAL_CODE: {
    referral_code: "GVJRESB4"
  },

  MIN_CHAT_DELAY: 5000,
  MAX_CHAT_DELAY: 15000,

  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,

  LOG_LEVEL: "info",
  MAX_LOG_SIZE: 10 * 1024 * 1024, // 10MB
};
