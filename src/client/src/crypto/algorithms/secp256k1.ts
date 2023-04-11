/*
Copyright 2016 - 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Defines m.olm encryption/decryption
 */
import Key from "../../nostr/src/Key";
import * as olmlib from "../olmlib";

import { nip04 } from "nostr-tools";

import type { IEventDecryptionResult } from "../../@types/crypto";
import { DecryptionAlgorithm, EncryptionAlgorithm, registerAlgorithm } from "./base";
import { Room } from "../../models/room";
import { IContent, MatrixEvent } from "../../models/event";
import { SECP256K1EncryptedContent } from "../index";
import { MsgType } from "matrix-js-sdk/lib/@types/event";
import { EventType } from "../../matrix";
import { handMediaContent } from "../../nostr/src/Helpers";
export interface IMessage {
    type: number;
    body: string;
}

/**
 * Olm encryption implementation
 *
 * @param params - parameters, as per {@link EncryptionAlgorithm}
 */
class Secp256k1Encryption extends EncryptionAlgorithm {
    /**
     * @param content - plaintext event content
     *
     * @returns Promise which resolves to the new event body
     */
    public async encryptMessage(room: Room, eventType: string, content: IContent): Promise<SECP256K1EncryptedContent> {
        const pubKey = Key.getPubKey();
        const priKey = Key.getPrivKey();
        const needEncryptText = content.url || content.body;
        const ciphertext = await nip04.encrypt(priKey, room.roomId, needEncryptText);
        return {
            ciphertext: {
                [pubKey]: {
                    type: 1,
                    body: ciphertext,
                },
            },
            sender_key: pubKey,
            algorithm: olmlib.SECP256K1,
        };
    }
}

/**
 * Olm decryption implementation
 *
 * @param params - parameters, as per {@link DecryptionAlgorithm}
 */
class Secp256k1Decryption extends DecryptionAlgorithm {
    /**
     * returns a promise which resolves to a
     * {@link EventDecryptionResult} once we have finished
     * decrypting. Rejects with an `algorithms.DecryptionError` if there is a
     * problem decrypting the event.
     */
    public async decryptEvent(event: MatrixEvent): Promise<IEventDecryptionResult> {
        // const pubKey = Key.getPubKey();
        const priKey = Key.getPrivKey();
        const content = event.getWireContent();
        const plaintext = await nip04.decrypt(priKey, event.getRoomId(), content.ciphertext);
        const resContent = handMediaContent({
            msgtype: MsgType.Text,
            body: plaintext,
        });
        return {
            clearEvent: {
                type: EventType.RoomMessage,
                content: resContent,
            },
        };
    }
}

registerAlgorithm(olmlib.SECP256K1, Secp256k1Encryption, Secp256k1Decryption);
