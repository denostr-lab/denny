// import "expect-puppeteer";
import { Browser, Page } from "puppeteer";
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
    searchLocalUserAndEnterRoom,
} from "../utils";
import { User } from "../@types/index";
describe("测试双人私聊聊天场景", () => {
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
        "登录",
        async () => {
            await Promise.all([login(user1.page, PRIVATE_KEY), login(user2.page, PRIVATE_KEY2)]);
        },
        90 * 1000,
    );

    it(
        "一起加入公共群聊",
        async () => {
            await Promise.all([enterPublicRoom(user1.page), enterPublicRoom(user2.page)]);
        },
        90 * 1000,
    );
    it(
        "用户1找到用户2并且发送一条聊天信息",
        async () => {
            // const { text: text1 } = await privateChatFromRoom(user1.page, user2.pubkey);
            // const { text: text2 } = await privateChatFromRoom(user2.page, user1.pubkey);

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
        "测试搜索用户并且发送信息",
        async () => {
            await Promise.all([
                findPrivateMessageRoomWithPubKey(user1.page, user2.pubkey),
                findPrivateMessageRoomWithPubKey(user2.page, user1.pubkey),
            ]);

            const text1 = `你好-${Math.random()}`;
            const text2 = `你好-${Math.random()}`;
            await sendMessage(user1.page, text1);
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
        "测试退出当前用户房间并且重新发送信息",
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
            const text1 = `你好我又回来了-${Math.random()}`;
            const text2 = `你好我又回来了-${Math.random()}`;
            await sendMessage(user1.page, text1);
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
        "测试搜索用户",
        async () => {
            await Promise.all([
                searchLocalUserAndEnterRoom(user1.page, user2.pubkey),
                searchLocalUserAndEnterRoom(user2.page, user1.pubkey),
            ]);
            await Promise.all([user1.page.waitForTimeout(1 * 1000), user2.page.waitForTimeout(1 * 1000)]);

            // const text1 = `我通过搜进来-${Math.random()}`;
            // const text2 = `我通过搜进来-${Math.random()}`;
            // await sendMessage(user1.page, text1);
            // await sendMessage(user2.page, text2);
            // const textExceptResult = await Promise.all([
            //     findTimeLineText(user2.page, text1),
            //     findTimeLineText(user1.page, text2),
            // ]);
            // const [result, result2] = textExceptResult;

            // expect(result).toEqual(text1);
            // expect(result2).toEqual(text2);
        },
        90 * 1000,
    );
});
