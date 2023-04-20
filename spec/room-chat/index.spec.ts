// import "expect-puppeteer";
import puppeteer, { Browser, Page } from "puppeteer";
import { PRIVATE_KEY } from "../data";
import {
    login,
    enterPublicRoom,
    privateChatFromRoom,
    sendMessage,
    findTimeLineText,
    createBrowserAndPage,
    sendFile,
    findTimeLineLastImage,
    sendEmojitoLast
    createPrivateMessageRoomWithPubKey,
    leaveRoom,
    searchLocalUserAndEnterRoom,
} from "../utils";
describe("公开群聊测试", () => {
    let browser: Browser;
    let page: Page;
    beforeAll(async () => {
        const result = await createBrowserAndPage();
        browser = result.browser;
        page = result.page;
    });
    afterAll(async () => {
        await page.close();
        await browser.close();
    });

    it(
        "test input private key",
        async () => {
            await login(page, PRIVATE_KEY);
        },
        30 * 1000,
    );
    it(
        "点击打开公开频道搜索并进入房间",
        async () => {
            await enterPublicRoom(page);
        },
        20 * 1000,
    );

    it(
        "测试发送聊天的普通信息",
        async () => {
            const text1 = `你好-${Math.random()}`;
            await sendMessage(page, text1);
            const resultText = await findTimeLineText(page, text1);
            expect(text1).toEqual(resultText);
        },
        20 * 1000,
    );
    it(
        "测试发送聊天的图片",
        async () => {
            const file = "spec/test.png";
            await sendFile(page, file);
            const resultText = await findTimeLineLastImage(page, file, "video");
            expect(resultText).toEqual(file);
        },
        30 * 1000,
    );
    it(
        "测试发送聊天的视频",
        async () => {
            const file = "spec/test.mp4";
            await sendFile(page, file);
            const resultText = await findTimeLineLastImage(page, file, "video");
            expect(resultText).toEqual(file);
        },
        20 * 1000,
    );
    it(
        "测试给某条信息加个emoji",
        async () => {
            const emoji = await sendEmojitoLast(page)
            const resultText = await findTimeLineLastImage(page, emoji, "emoji");
            expect(resultText).toEqual(emoji);
        },
        20 * 1000,
    );
    it(
        "回复某人的信息",
        async () => {
            await page.waitForSelector(".timeline__wrapper");
            await page.hover(".timeline__wrapper>div:last-child");
            await page.waitForSelector(".timeline__wrapper");
            await page.$eval(".timeline__wrapper>div:last-child .message__options button:nth-child(2)", (el) => {
                el.click();
            });
            await page.waitForTimeout(0.5 * 1000);

            const text = `我的回复哈哈哈哈哈${Math.random()}`;
            await page.$eval(".room-input__input-container textarea", async (el) => {
                el.focus();
            });
            await page.keyboard.type(text);
            await page.waitForTimeout(0.5 * 1000);
            await page.keyboard.press("Enter");
            let t: number;
            let count = 0;
            await new Promise((res) => {
                t = setInterval(async () => {
                    let name = "";
                    try {
                        name = await page.$eval(".timeline__wrapper>div:last-child .message__body div", (el) => {
                            return el.innerText;
                        });
                    } catch (e) {}
                    if (name === text) {
                        clearInterval(t);
                        res(0);
                    } else if (count > 10) {
                        expect(name).toEqual(text);
                        clearInterval(t);

                        // 错误了
                        throw Error("传送错误");
                    }
                    count += 1;
                }, 1000);
            });
        },
        20 * 1000,
    );

    it(
        "搜索群成员",
        async () => {
            await page.waitForSelector(".sidebar__sticky button");
            await page.click(".sidebar__sticky button:nth-child(2)");
            await page.waitForSelector(".ReactModal__Content--after-open .profile-editor__info");
            const name = await page.$eval(".ReactModal__Content--after-open .profile-editor__info h2", (el) => {
                return el.innerText;
            });

            const pubkey = await page.$eval(".ReactModal__Content--after-open .profile-editor__info p", (el) => {
                return el.innerText;
            });
            await page.click(".pw__content .header button:nth-child(3)");

            await page.waitForSelector(".people-drawer__sticky .people-search");

            await page.$eval(".people-drawer__sticky .people-search input", (el) => {
                el.value = "";
                el.focus();
            });
            await page.waitForTimeout(0.5 * 1000);

            await page.keyboard.type(pubkey);
            await page.waitForTimeout(1 * 1000);

            let resultName = await page.$eval(".people-selector__container .people-selector p", (el) => {
                return el.innerText;
            });
            expect(name).toContain(resultName);
            await page.$eval(".people-drawer__sticky .people-search input", (el) => {
                el.value = "";
                el.focus();
            });
            await page.keyboard.type(pubkey + "111");
            await page.waitForTimeout(1 * 1000);

            resultName = await page.$eval(".people-drawer__noresult p", (el) => {
                return el.innerText;
            });
            expect(resultName).toEqual("No results found!");
            await page.$eval(".people-drawer__sticky .people-search input", (el) => {
                el.value = "";
                el.focus();
            });
            await page.keyboard.type(name);

            resultName = await page.$eval(".people-selector__container .people-selector p", (el) => {
                return el.innerText;
            });

            expect(name).toContain(resultName);
        },
        9990 * 1000,
    );
});
