// import "expect-puppeteer";
import puppeteer, { Browser, Page } from "puppeteer";
import { Event, generatePrivateKey, getPublicKey, nip04, signEvent } from "nostr-tools";

import { PRIVATE_KEY, PRIVATE_KEY2 } from "../data";
import { login, enterPublicRoom, privateChatFromRoom, findTimeLineText, createBrowserAndPage } from "../utils";
interface User {
    page: Page;
    browser: Browser;
    pubkey: string;
    close: () => void;
}
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
    });
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
});
