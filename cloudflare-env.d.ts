declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    MT5_SERVICE_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}
