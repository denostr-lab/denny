/*
Copyright 2015 - 2021 The Matrix.org Foundation C.I.C.

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

import { getHttpUriForMxc } from "../content-repo";
import * as utils from "../utils";
import { User } from "./user";
import { MatrixEvent } from "./event";
import { RoomState } from "./room-state";
import { logger } from "../logger";
import { TypedEventEmitter } from "./typed-event-emitter";
import { EventType } from "../@types/event";
export enum ContactEvent {
    Change = "Contact.change",
}
interface IContactInfo {
    id: string;
    petname: string;
    relay: string;
    senderId: string;
}
export type ContactEventHandlerMap = {
    /**
     * Fires whenever any contact changes.
     * @example
     * ```
     * matrixClient.on("Contact.change", function(){
  
     * });
     * ```
     */
    [ContactEvent.Change]: () => void;
};

export class Contact extends TypedEventEmitter<ContactEvent, ContactEventHandlerMap> {
    /**
     * The human-readable name for this room member. This will be
     * disambiguated with a suffix of " (\@user_id:matrix.org)" if another member shares the
     * same displayname.
     */
    public name: string;

    /**
     * The User object for this room member, if one exists.
     */
    public user?: User;

    public relay: string;
    public senderId: string;
    public userId: string;

    /**
     * Construct a new room member.
     *
     * @param roomId - The room ID of the member.
     * @param userId - The user ID of the member.
     */
    public constructor(contact: IContactInfo) {
        super();

        this.name = contact.petname ?? "";
        this.relay = contact.relay ?? "";
        this.userId = contact.id;
        this.senderId = contact.senderId;
    }

    public getRelay() {
        return this.relay ?? "";
    }
}
