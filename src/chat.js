import Gun from 'gun';
import util from './util';

/**
* Private communication channel between two or more participants. Can be used
* independently of other Iris stuff.
*
* Messages are encrypted and chat ids obfuscated, but it is possible to guess
* who are communicating with each other by looking at Gun timestamps and subscriptions.
*
* options.onMessage callback is not guaranteed to receive messages ordered by timestamp.
* You should sort them in the presentation layer.
*
* @param {Object} options {key, gun, chatLink, onMessage, participants}
* @example https://github.com/irislib/iris-lib/blob/master/__tests__/chat.js
*/
class Chat {
  constructor(options) {
    this.key = options.key;
    this.gun = options.gun;
    this.user = this.gun.user();
    this.user.auth(this.key);
    this.user.put({epub: this.key.epub});
    this.secrets = {}; // maps participant public key to shared secret
    this.ourSecretChatIds = {}; // maps participant public key to our secret chat id
    this.theirSecretChatIds = {}; // maps participant public key to their secret chat id
    this.onMessage = options.onMessage;

    console.log('Chat() options', options);
    if (options.chatLink) {
      console.log('initializing with chatLink', options.chatLink);
      const s = options.chatLink.split('?');
      console.log('s', s);
      if (s.length === 2) {
        const pub = util.getUrlParameter('chatWith', s[1]);
        options.participants = pub;
        const sharedSecret = util.getUrlParameter('s', s[1]);
        const linkId = util.getUrlParameter('k', s[1]);
        if (sharedSecret && linkId) {
          console.log('getting shared key from chat link');
          this.gun.user(pub).get('chatLinks').get(linkId).get('encryptedSharedKey').on(async encrypted => {
            console.log('encrypted shared key', encrypted, 'trying to decrypt with sharedSecret', sharedSecret);
            const sharedKey = await Gun.SEA.decrypt(encrypted, sharedSecret);
            console.log('shared key is', sharedKey);
            const encryptedChatRequest = await Gun.SEA.encrypt(this.key.pub, sharedSecret);
            const chatRequestId = await Gun.SEA.work(encryptedChatRequest, null, null, {name: 'SHA-256'});
            const u = this.gun.user();
            u.auth(sharedKey);
            u.get('chatRequests').get(chatRequestId.slice(0, 12)).put(encryptedChatRequest).then(() => {
              u.auth(this.key);
            });
          });
        }
      }
    }

    if (typeof options.participants === `string`) {
      this.addPub(options.participants);
    } else if (Array.isArray(options.participants)) {
      for (let i = 0;i < options.participants.length;i++) {
        if (typeof options.participants[i] === `string`) {
          this.addPub(options.participants[i]);
        } else {
          console.log(`participant public key must be string, got`, typeof options.participants[i], options.participants[i]);
        }
      }
    }
  }

  async getSecret(pub) {
    if (!this.secrets[pub]) {
      const epub = await this.gun.user(pub).get(`epub`).once().then();
      this.secrets[pub] = await Gun.SEA.secret(epub, this.key);
    }
    return this.secrets[pub];
  }

  /**
  *
  */
  static async getOurSecretChatId(gun, pub, pair) {
    const epub = await gun.user(pub).get(`epub`).once().then();
    const secret = await Gun.SEA.secret(epub, pair);
    return Gun.SEA.work(secret + pub, null, null, {name: 'SHA-256'});
  }

  /**
  *
  */
  static async getTheirSecretChatId(gun, pub, pair) {
    const epub = await gun.user(pub).get(`epub`).once().then();
    const secret = await Gun.SEA.secret(epub, pair);
    return Gun.SEA.work(secret + pair.pub, null, null, {name: 'SHA-256'});
  }

  /**
  * Return a list of public keys that you have initiated a chat with or replied to.
  * (Chats that are initiated by others and unreplied by you don't show up, because
  * this method doesn't know where to look for them. Use socialNetwork.getChats() to listen to new chats from friends.)
  * @param {Object} gun user.authed gun instance
  * @param {Object} keypair SEA keypair that the gun instance is authenticated with
  * @param callback callback function that is called for each public key you have a chat with
  */
  static async getChats(gun, keypair, callback) {
    const mySecret = await Gun.SEA.secret(keypair.epub, keypair);
    gun.user().get(`chats`).map().on(async (value, ourSecretChatId) => {
      if (value) {
        gun.user().get(`chats`).get(ourSecretChatId).get(`pub`).once(async encryptedPub => {
          const pub = await Gun.SEA.decrypt(encryptedPub, mySecret);
          callback(pub);
        });
      }
    });
  }

  async getOurSecretChatId(pub) {
    if (!this.ourSecretChatIds[pub]) {
      const secret = await this.getSecret(pub);
      this.ourSecretChatIds[pub] = await Gun.SEA.work(secret + pub, null, null, {name: 'SHA-256'});
    }
    return this.ourSecretChatIds[pub];
  }

  async getTheirSecretChatId(pub) {
    if (!this.theirSecretChatIds[pub]) {
      const secret = await this.getSecret(pub);
      this.theirSecretChatIds[pub] = await Gun.SEA.work(secret + this.key.pub, null, null, {name: 'SHA-256'});
    }
    return this.theirSecretChatIds[pub];
  }

  async messageReceived(data, pub, selfAuthored) {
    if (this.onMessage) {
      const decrypted = await Gun.SEA.decrypt(data, (await this.getSecret(pub)));
      if (typeof decrypted !== `object`) {
        // console.log(`chat data received`, decrypted);
        return;
      }
      this.onMessage(decrypted, {selfAuthored});
    } else {
      // console.log(`chat message received`, decrypted);
    }
  }

  /**
  * Get latest message in this chat. Useful for chat listing.
  */
  async getLatestMsg(callback) {
    const keys = Object.keys(this.secrets);
    for (let i = 0;i < keys.length;i++) {
      const ourSecretChatId = await this.getOurSecretChatId(keys[i]);
      this.user.get(`chats`).get(ourSecretChatId).get(`latestMsg`).on(async data => {
        const decrypted = await Gun.SEA.decrypt(data, (await this.getSecret(keys[i])));
        if (typeof decrypted !== `object`) {
          // console.log(`chat data received`, decrypted);
          return;
        }
        callback(decrypted, {});
      });
    }
  }

  /**
  * Useful for notifications
  * @param {integer} time last seen msg time (default: now)
  */
  async setMyMsgsLastSeenTime(time) {
    const keys = Object.keys(this.secrets);
    time = time || new Date().toISOString();
    for (let i = 0;i < keys.length;i++) {
      const encrypted = await Gun.SEA.encrypt(time, (await this.getSecret(keys[i])));
      const ourSecretChatId = await this.getOurSecretChatId(keys[i]);
      this.user.get(`chats`).get(ourSecretChatId).get(`msgsLastSeenTime`).put(encrypted);
    }
  }

  /**
  * Useful for notifications
  */
  async getMyMsgsLastSeenTime(callback) {
    const keys = Object.keys(this.secrets);
    for (let i = 0;i < keys.length;i++) {
      const ourSecretChatId = await this.getOurSecretChatId(keys[i]);
      this.gun.user().get(`chats`).get(ourSecretChatId).get(`msgsLastSeenTime`).on(async data => {
        this.myMsgsLastSeenTime = await Gun.SEA.decrypt(data, (await this.getSecret(keys[i])));
        if (callback) {
          callback(this.myMsgsLastSeenTime);
        }
      });
    }
  }

  /**
  * For "seen" status indicator
  */
  async getTheirMsgsLastSeenTime(callback) {
    const keys = Object.keys(this.secrets);
    for (let i = 0;i < keys.length;i++) {
      const theirSecretChatId = await this.getTheirSecretChatId(keys[i]);
      this.gun.user(keys[i]).get(`chats`).get(theirSecretChatId).get(`msgsLastSeenTime`).on(async data => {
        this.theirMsgsLastSeenTime = await Gun.SEA.decrypt(data, (await this.getSecret(keys[i])));
        if (callback) {
          callback(this.theirMsgsLastSeenTime, keys[i]);
        }
      });
    }
  }

  /**
  * Add a public key to the chat
  * @param {string} pub
  */
  async addPub(pub) {
    this.secrets[pub] = null;
    this.getSecret(pub);
    // Save their public key in encrypted format, so in chat listing we know who we are chatting with
    const ourSecretChatId = await this.getOurSecretChatId(pub);
    const mySecret = await Gun.SEA.secret(this.key.epub, this.key);
    this.gun.user().get(`chats`).get(ourSecretChatId).get(`pub`).put(await Gun.SEA.encrypt(pub, mySecret));
    // Subscribe to their messages
    const theirSecretChatId = await this.getTheirSecretChatId(pub);
    this.gun.user(pub).get(`chats`).get(theirSecretChatId).get(`msgs`).map().once(data => {this.messageReceived(data, pub);});
    // Subscribe to our messages
    this.user.get(`chats`).get(ourSecretChatId).get(`msgs`).map().once(data => {this.messageReceived(data, pub, true);});
  }

  /**
  * Send a message to the chat
  * @param msg string or {time, author, text} object
  */
  async send(msg) {
    if (typeof msg === `string`) {
      msg = {
        time: (new Date()).toISOString(),
        author: `anonymous`,
        text: msg
      };
    }

    //this.gun.user().get('message').set(temp);
    const keys = Object.keys(this.secrets);
    for (let i = 0;i < keys.length;i++) {
      const encrypted = await Gun.SEA.encrypt(JSON.stringify(msg), (await this.getSecret(keys[i])));
      const ourSecretChatId = await this.getOurSecretChatId(keys[i]);
      this.user.get(`chats`).get(ourSecretChatId).get(`msgs`).get(`${msg.time}`).put(encrypted);
      this.user.get(`chats`).get(ourSecretChatId).get(`latestMsg`).put(encrypted);
    }
  }

  /**
  * Set the user's online status
  * @param {object} gun
  * @param {boolean} isOnline true: update the user's lastActive time every 3 seconds, false: stop updating
  */
  static setOnline(gun, isOnline) {
    if (isOnline) {
      const update = () => {
        gun.user().get(`lastActive`).put(Math.round(Gun.state() / 1000));
      };
      update();
      gun.setOnlineInterval = setInterval(update, 3000);
    } else {
      clearInterval(gun.setOnlineInterval);
    }
  }

  /**
  * Get the online status of a user.
  *
  * @param {object} gun
  * @param {string} pubKey public key of the user
  * @param {boolean} callback receives a boolean each time the user's online status changes
  */
  static getOnline(gun, pubKey, callback) {
    let timeout;
    gun.user(pubKey).get(`lastActive`).on(lastActive => {
      clearTimeout(timeout);
      const now = Math.round(Gun.state() / 1000);
      const isOnline = lastActive > now - 10 && lastActive < now + 30;
      callback({isOnline, lastActive});
      if (isOnline) {
        timeout = setTimeout(() => callback({isOnline: false, lastActive}), 10000);
      }
    });
  }

  /**
  * In order to receive messages from others, this method must be called for newly created
  * users that have not started a chat with an existing user yet.
  *
  * It saves the user's key.epub (public key for encryption) into their gun user space,
  * so others can find it and write encrypted messages to them.
  *
  * If you start a chat with an existing user, key.epub is saved automatically and you don't need
  * to call this method.
  */
  static initUser(gun, key) {
    const user = gun.user();
    user.auth(key);
    user.put({epub: key.epub});
  }

  static formatChatLink(urlRoot, pub, sharedSecret, linkId) {
    return `${urlRoot}?chatWith=${encodeURIComponent(pub)}&s=${encodeURIComponent(sharedSecret)}&k=${encodeURIComponent(linkId)}`;
  }

  /**
  * Creates a chat link that can be used for two-way communication, i.e. only one link needs to be exchanged.
  */
  static async createChatLink(gun, key, urlRoot = 'https://chat.iris.to/') {
    const user = gun.user();
    user.auth(key);

    const sharedKey = await Gun.SEA.pair();
    const sharedKeyString = JSON.stringify(sharedKey);
    const sharedSecret = await Gun.SEA.secret(sharedKey.epub, sharedKey);
    const encryptedSharedKey = await Gun.SEA.encrypt(sharedKeyString, sharedSecret);
    const ownerSecret = await Gun.SEA.secret(key.epub, key);
    console.log('encrypting mySecret', ownerSecret);
    const ownerEncryptedSharedKey = await Gun.SEA.encrypt(sharedKeyString, ownerSecret);
    let linkId = await Gun.SEA.work(encryptedSharedKey, undefined, undefined, {name: `SHA-256`});
    linkId = linkId.slice(0, 12);

    console.log('shared key is', sharedKey);
    console.log('shared secret is', sharedSecret);
    console.log('saving encryptedSharedKey', encryptedSharedKey, 'encrypted with secret', sharedSecret);
    user.get('chatLinks').get(linkId).get('encryptedSharedKey').put(encryptedSharedKey);
    console.log('saving ownerEncryptedSharedKey', ownerEncryptedSharedKey, 'encrypted with secret', ownerSecret);
    user.get('chatLinks').get(linkId).get('ownerEncryptedSharedKey').put(ownerEncryptedSharedKey);

    return Chat.formatChatLink(urlRoot, key.pub, sharedSecret, linkId);
  }

  static async getMyChatLinks(gun, key, urlRoot = 'https://chat.iris.to/', callback, subscribe = true) {
    const user = gun.user();
    user.auth(key);
    const mySecret = await Gun.SEA.secret(key.epub, key);
    user.get('chatLinks').map().once((data, linkId) => {
      if (!data) { return; }
      const chats = [];
      console.log('got linkId', linkId, data);
      user.get('chatLinks').get(linkId).get('ownerEncryptedSharedKey').on(async enc => {
        console.log(linkId, 'ownerEncryptedSharedKey', enc);
        if (!enc) { return; }
        const sharedKey = await Gun.SEA.decrypt(enc, mySecret);
        console.log('getMyChatLinks: got sharedKey', sharedKey, 'decrypted with', mySecret);
        const sharedSecret = await Gun.SEA.secret(sharedKey.epub, sharedKey);
        console.log('getMyChatLinks: got sharedSecret', sharedSecret, 'derived from', sharedKey);
        const chatLink = Chat.formatChatLink(urlRoot, key.pub, sharedSecret, linkId);
        if (callback) {
          callback(chatLink);
        }
        if (subscribe) {
          gun.user(sharedKey.pub).get('chatRequests').map().once(async encPub => {
            console.log('chat request from encPub', encPub);
            const s = JSON.stringify(encPub);
            if (chats.indexOf(s) === -1) {
              chats.push(s);
              const pub = await Gun.SEA.decrypt(encPub, sharedSecret);
              console.log('hey!',pub, 'followed our chat link!');
              const chat = new Chat({gun, key, participants: pub});
              chat.send(`thanks for following my chat link!`); // TODO: save the chat without sending a msg
            }
          });
        }
      });
    });
  }

  static removeChatLink(gun, key, linkId) {
    gun.user().auth(key);
    gun.user().get('chatLinks').get(linkId).put(null);
  }
}

export default Chat;
