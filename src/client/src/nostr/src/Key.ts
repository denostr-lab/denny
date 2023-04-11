import {
  Event,
  generatePrivateKey,
  getPublicKey,
  nip04,
  signEvent,
} from "nostr-tools";
import { Buffer } from 'buffer'
import Events from "./Events";
import * as bech32 from "bech32-buffer";
import { arrayToHex } from "./Helpers";

export interface Key {
  priv: string;
  rpub: string;
}

declare global {
  interface Window {
    nostr: any; // possible nostr browser extension
  }
}

class NostrKey {
  windowNostrQueue: any[] = [];

  isProcessingQueue = false;

  key: Key | null = null;

  getPublicKey = getPublicKey;

  private keyName = 'nostr.key';

  loginAsNewUser(): void {
    this.login(this.generateKey());
  }

  login(key: Key): void {
    this.key = key;
    localStorage.setItem(this.keyName, JSON.stringify(key));
  }

  generateKey(): Key {
    const priv = generatePrivateKey();
    return {
      priv,
      rpub: getPublicKey(priv),
    };
  }

  getOrCreate(options: { autologin?: boolean }): Key | null {
    const localStorageKey = localStorage.getItem(this.keyName);
    if (localStorageKey) {
      this.key = JSON.parse(localStorageKey);
      console.log("loaded key from localStorage", this.key);
    } else if (options.autologin !== false) {
      this.key = this.generateKey();
    }

    return this.key;
  }

  getPubKey(): string {
    return this.key?.rpub ?? "";
  }

  getPrivKey(): string {
    return this.key?.priv ?? "";
  }

  encrypt = async function (data: string, pub?: string): Promise<string> {
    const k = this.key;
    pub = pub || k?.rpub;
    if (k?.priv) {
      return nip04.encrypt(k.priv, pub, data);
    } else if (window.nostr) {
      return new Promise((resolve) => {
        this.processWindowNostr({
          op: "encrypt",
          data,
          pub,
          callback: resolve,
        });
      });
    } else {
      return Promise.reject("no private key");
    }
  };

  decrypt = async function (data: string, pub?: string): Promise<string> {
    const k = this.key;
    pub = pub || k?.rpub;
    if (k?.priv) {
      return nip04.decrypt(k.priv, pub, data);
    } else if (window.nostr) {
      return new Promise((resolve) => {
        this.processWindowNostr({
          op: "decrypt",
          data,
          pub,
          callback: resolve,
        });
      });
    } else {
      return Promise.reject("no private key");
    }
  };

  sign = async function (event: Event): Promise<string> {
    const priv = this.getPrivKey();
    if (priv) {
      return signEvent(event, priv);
    } else if (window.nostr) {
      return new Promise((resolve) => {
        this.processWindowNostr({ op: "sign", data: event, callback: resolve });
      });
    } else {
      return Promise.reject("no private key");
    }
  };

  processWindowNostr(item: any): void {
    this.windowNostrQueue.push(item);
    if (!this.isProcessingQueue) {
      this.processWindowNostrQueue();
    }
  }

  async processWindowNostrQueue(): Promise<void> {
    if (!this.windowNostrQueue.length) {
      this.isProcessingQueue = false;
      return;
    }
    this.isProcessingQueue = true;
    const { op, data, pub, callback } = this.windowNostrQueue[0];

    let fn = Promise.resolve();
    if (op === "decrypt") {
      fn = this.handlePromise(window.nostr.nip04.decrypt(pub, data), callback);
    } else if (op === "encrypt") {
      fn = this.handlePromise(window.nostr.nip04.encrypt(pub, data), callback);
    } else if (op === "sign") {
      fn = this.handlePromise(window.nostr.signEvent(data), (signed) =>
        callback(signed && signed.sig)
      );
    }
    await fn;
    this.windowNostrQueue.shift();
    this.processWindowNostrQueue();
  }
  handlePromise<T>(promise: Promise<T>, callback: (result: T | null) => void): Promise<void> {
    return promise
      .then((result) => {
        callback(result);
      })
      .catch((error) => {
        console.error(error);
        callback(null);
      });
  }
  async decryptMessage(
    id: string,
    cb: (decrypted: string) => void
  ): Promise<void> {
    const existing = Events.decryptedMessages.get(id);
    if (existing) {
      cb(existing);
      return;
    }
    try {
      const myPub = this.getPubKey();
      const msg = Events.db.by("id", id);
      const theirPub =
        msg.pubkey === myPub
          ? msg.tags.find((tag: any) => tag[0] === "p")[1]
          : msg.pubkey;
      if (!(msg && theirPub)) {
        return;
      }
      let decrypted = await this.decrypt(msg.content, theirPub);
      if (decrypted.content) {
        decrypted = decrypted.content; // what? TODO debug
      }
      Events.decryptedMessages.set(id, decrypted);
      cb(decrypted);
    } catch (e) {
      console.error(e);
    }
  }
  async getPubKeyByNip05Address(address: string): Promise<string | null> {
    try {
      const [localPart, domain] = address.split('@');
      const url = `https://${domain}/.well-known/nostr.json?name=${localPart}`;
      const response = await fetch(url);
      const json = await response.json();
      const names: Record<string, string> = json.names;
      return names[localPart] || null;
    } catch (error) {
      console.error(error);
      return null;
    }
  }
  async verifyNip05Address(address: string, pubkey: string): Promise<boolean> {
    try {
      const [username, domain] = address.split('@');
      const url = `https://${domain}/.well-known/nostr.json?name=${username}`;
      const response = await fetch(url);
      const json = await response.json();
      const names = json.names;
      return names[username] === pubkey || names[username.toLowerCase()] === pubkey;
    } catch (error) {
      // gives lots of cors errors:
      console.error(error);
      return false;
    }
  }
  toNostrBech32Address(address: string, prefix: string): string | null {
    if (!prefix) {
      throw new Error('prefix is required');
    }
    try {
      const decoded = bech32.decode(address);
      if (prefix !== decoded.prefix) {
        return null;
      }
      return bech32.encode(prefix, decoded.data);
    } catch (e) {
      // not a bech32 address
    }
  
    if (address.match(/^[0-9a-fA-F]{64}$/)) {
      const words = Buffer.from(address, 'hex');
      return bech32.encode(prefix, words);
    }
    return null;
  }
  toNostrHexAddress(str: string): string | null {
    if (str.match(/^[0-9a-fA-F]{64}$/)) {
      return str;
    }
    try {
      const { data } = bech32.decode(str);
      const addr = arrayToHex(data);
      return addr;
    } catch (e) {
      // not a bech32 address
    }
    return null;
  }
}

export default new NostrKey()
