// Prints a new VAPID key pair for the push server (worker/).
import { b64url } from '../worker/src/webpush.js';

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = b64url(await crypto.subtle.exportKey('raw', publicKey));
const { d } = await crypto.subtle.exportKey('jwk', privateKey);
console.log(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${d}`);
