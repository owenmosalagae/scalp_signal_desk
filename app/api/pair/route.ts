import { env } from "cloudflare:workers";

const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), x => x.charCodeAt(0));
const encode = (value: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (!request.headers.get("oai-authenticated-user-id") || request.headers.get("origin") !== origin)
    return new Response("Sign in to pair your connector.", { status: 403 });
  if (!env.MT5_SERVICE_TOKEN)
    return new Response("Connector access has not been configured.", { status: 503 });
  const form = await request.formData();
  const state = String(form.get("state") || "");
  const port = Number(form.get("port"));
  const publicKey = String(form.get("key") || "");
  if (!/^[a-f0-9]{64}$/.test(state) || !Number.isInteger(port) || port < 1024 || port > 65535 || publicKey.length > 1200)
    return new Response("Invalid pairing request.", { status: 400 });
  try {
    const rsa = await crypto.subtle.importKey("spki", decode(publicKey),
      { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify({ site: origin, token: env.MT5_SERVICE_TOKEN }));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsa, await crypto.subtle.exportKey("raw", key));
    const payload = encode(new TextEncoder().encode(JSON.stringify({ key: encode(wrapped), iv: encode(iv), data: encode(encrypted) })));
    const destination = new URL("http://127.0.0.1:" + port + "/paired");
    destination.searchParams.set("state", state);
    destination.searchParams.set("payload", payload);
    return new Response(null, { status: 303, headers: {
      Location: destination.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    } });
  } catch {
    return new Response("The connector key is invalid. Restart the connector and pair again.", { status: 400 });
  }
}
