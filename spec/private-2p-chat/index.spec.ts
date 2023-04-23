import { getPublicKey } from "nostr-tools";

import { PRIVATE_KEY, PRIVATE_KEY2 } from "../data";
import {
    login,
    enterPublicRoom,
    privateChatFromRoom,
    sendMessage,
    findTimeLineText,
    createBrowserAndPage,
    findPrivateMessageRoomWithPubKey,
    leaveRoom,
} from "../utils";
import { User } from "../@types/index";
describe("test two people chat", () => {
    let user1: User = {
        page: null,
        browser: null,
        pubkey: getPublicKey(PRIVATE_KEY),
    } as unknown as User;
    let user2: User = {
        page: null,
        browser: null,
        pubkey: getPublicKey(PRIVATE_KEY2),
    } as unknown as User;
    beforeAll(async () => {
        const result1 = await createBrowserAndPage();
        user1 = { ...user1, ...result1 };
        const result2 = (await createBrowserAndPage()) as unknown as User;
        user2 = { ...user2, ...result2 };
    }, 360 * 1000);
    afterAll(async () => {
        await user1.browser.close();
        await user2.browser.close();
    });

    it(
        "login",
        async () => {
            await Promise.all([login(user1.page, PRIVATE_KEY), login(user2.page, PRIVATE_KEY2)]);
        },
        90 * 1000,
    );

    it(
        "enter public room",
        async () => {
            await Promise.all([enterPublicRoom(user1.page), enterPublicRoom(user2.page)]);
        },
        90 * 1000,
    );
    it(
        "send message to user",
        async () => {
            const textResult = await Promise.all([
                privateChatFromRoom(user1.page, user2.pubkey),
                privateChatFromRoom(user2.page, user1.pubkey, 2000),
            ]);
            const text1 = textResult[0].text;
            const text2 = textResult[1].text;
            const textExceptResult = await Promise.all([
                findTimeLineText(user2.page, text1),
                findTimeLineText(user1.page, text2),
            ]);
            const [result, result2] = textExceptResult;

            expect(result).toEqual(text1);
            expect(result2).toEqual(text2);
        },
        90 * 1000,
    );
    it(
        "search user and send message",
        async () => {
            await Promise.all([
                findPrivateMessageRoomWithPubKey(user1.page, user2.pubkey),
                findPrivateMessageRoomWithPubKey(user2.page, user1.pubkey),
            ]);

            const text1 = `hellow-${Math.random()} ${new Date().toISOString()}`;
            await sendMessage(user1.page, text1);
            const text2 = `hellow-${Math.random()} ${new Date().toISOString()}`;
            await sendMessage(user2.page, text2);
            const textExceptResult = await Promise.all([
                findTimeLineText(user2.page, text1),
                findTimeLineText(user1.page, text2),
            ]);
            const [result, result2] = textExceptResult;

            expect(result).toEqual(text1);
            expect(result2).toEqual(text2);
        },
        90 * 1000,
    );
    it(
        "leave room and resend message",
        async () => {
            await Promise.all([
                findPrivateMessageRoomWithPubKey(user1.page, user2.pubkey),
                findPrivateMessageRoomWithPubKey(user2.page, user1.pubkey),
            ]);
            await leaveRoom(user1.page);
            await leaveRoom(user2.page);
            await user1.page.waitForTimeout(1 * 1000);
            await user2.page.waitForTimeout(1 * 1000);

            await Promise.all([
                findPrivateMessageRoomWithPubKey(user1.page, user2.pubkey),
                findPrivateMessageRoomWithPubKey(user2.page, user1.pubkey),
            ]);
            const text1 = `my back-${Math.random()} ${new Date().toISOString()}`;
            await sendMessage(user1.page, text1);
            const text2 = `my back-${Math.random()} ${new Date().toISOString()}`;

            await sendMessage(user2.page, text2);
            const textExceptResult = await Promise.all([
                findTimeLineText(user2.page, text1),
                findTimeLineText(user1.page, text2),
            ]);
            const [result, result2] = textExceptResult;

            expect(result).toEqual(text1);
            expect(result2).toEqual(text2);
        },
        90 * 1000,
    );
});
