// import "expect-puppeteer";
import puppeteer, { Browser, Page } from "puppeteer";
import { PRIVATE_KEY } from "../data";
import { clearInterval } from "timers";
describe("公开群聊测试", () => {
    let browser: Browser;
    let page: Page;
    beforeAll(async () => {
        browser = await puppeteer.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        page = await browser.newPage();
        await page.setViewport({
            width: 1600,
            height: 1200,
        });
        // await page.goto("https://baidu.com");
    });
    afterAll(async () => {
        await page.close();
        await browser.close();
    });

    it(
        "test input private key",
        async () => {
            await page.goto("http://localhost:8081/", { timeout: 90000 });
            await page.evaluate(() => {});
            await page.$eval('button[type="button"]', (el) => el.click());
            await page.waitForSelector("input[name='privatekey']");
            await page.focus("input[name='privatekey']");
            await page.keyboard.type(PRIVATE_KEY);

            // await page.$eval("input[type='privatekey']", (el) => (el.value = PRIVATE_KEY));

            await page.keyboard.press("Enter");
        },
        30 * 1000,
    );
    it(
        "点击打开公开频道搜索",
        async () => {
            await page.waitForSelector(".header button");
            const header = await page.$(".header");
            await header?.$eval("button", (e) => {
                e.click();
            });
            await page.waitForSelector(".context-menu__item");
            await page.waitForTimeout(1 * 1000);

            await page.$$eval(".context-menu__item button", (el) => {
                el[1].click();
            });
            await page.waitForSelector(".public-rooms__input-wrapper");
            await page.waitForTimeout(3 * 1000);
            await page.$eval(".public-rooms__form button", (el) => {
                el.click();
            });
            // 随机加入一个房间
            await page.waitForSelector(".public-rooms__content button");
            await page.waitForTimeout(3 * 1000);

            await page.$eval(".public-rooms__content button", (el) => {
                el.click();
            });
            try {
                await page.$eval(".pw__content .header button", (el) => {
                    el.click();
                });
            } catch (e) {}

            await page.waitForSelector(".room-selector__content");

            await page.$$eval(".room-selector__content", (el) => {
                el.map((i) => {
                    if (i.querySelectorAll("p")[0].innerText === "房间1号") {
                        i.click();
                    }
                });
            });

            // await page.waitForTimeout(9000 * 1000);
        },
        20 * 1000,
    );

    // it(
    //     "测试发送聊天的普通信息",
    //     async () => {
    //         await page.waitForSelector(".room-input__input-container");

    //         await page.waitForTimeout(2 * 1000);
    //         // 随机加入一个房间
    //         const text = `你好啊哈哈${Math.random()}`;
    //         await page.$eval(".room-input__input-container textarea", async (el) => {
    //             el.focus();
    //         });
    //         await page.keyboard.type(text);
    //         await page.waitForTimeout(0.5 * 1000);
    //         await page.keyboard.press("Enter");
    //         let t: number;
    //         let count = 0;
    //         await new Promise((res) => {
    //             t = setInterval(async () => {
    //                 let name = "";
    //                 try {
    //                     name = await page.$eval(".timeline__wrapper>div:last-child p", (el) => {
    //                         return el.innerHTML;
    //                     });
    //                 } catch (e) {}
    //                 if (name === text) {
    //                     clearInterval(t);
    //                     res(0);
    //                 } else if (count > 10) {
    //                     expect(name).toEqual(text);
    //                     clearInterval(t);

    //                     // 错误了
    //                     throw Error("传送错误");
    //                 }
    //                 count += 1;
    //             }, 1000);
    //         });

    //         // await page.waitForTimeout(9000 * 1000);
    //     },
    //     20 * 1000,
    // );
    // it(
    //     "测试发送聊天的图片",
    //     async () => {
    //         await page.waitForSelector(".room-input__input-container");
    //         const elementHandle = await page.$("input[type=file]");
    //         await elementHandle!.uploadFile("spec/test.png");
    //         await page.waitForSelector(".room-attachment__info");
    //         await page.waitForTimeout(1 * 1000);
    //         await page.keyboard.press("Enter");
    //         let t: number;
    //         let count = 0;
    //         await new Promise((res) => {
    //             t = setInterval(async () => {
    //                 count += 1;
    //                 let name = "";
    //                 try {
    //                     name = await page.$eval(".timeline__wrapper>div:last-child img", (el) => {
    //                         return el.alt;
    //                     });
    //                 } catch (e) {}

    //                 if (name === "test.png") {
    //                     clearInterval(t);
    //                     res(0);
    //                 } else if (count > 10) {
    //                     // 错误了
    //                     throw Error("传送错误");
    //                 }
    //             }, 1000);
    //         });
    //     },
    //     30 * 1000,
    // );
    // it(
    //     "测试发送聊天的视频",
    //     async () => {
    //         await page.waitForSelector(".room-input__input-container");
    //         const elementHandle = await page.$("input[type=file]");
    //         await elementHandle!.uploadFile("spec/test.mp4");
    //         await page.waitForSelector(".room-attachment__info");

    //         await page.waitForTimeout(1 * 1000);
    //         await page.keyboard.press("Enter");
    //         let t: number;
    //         let count = 0;
    //         await new Promise((res) => {
    //             t = setInterval(async () => {
    //                 count += 1;
    //                 let name = "";
    //                 try {
    //                     name = await page.$eval(".timeline__wrapper>div:last-child p", (el) => {
    //                         return el.innerText;
    //                     });
    //                 } catch (e) {}

    //                 if (name === "test.mp4") {
    //                     clearInterval(t);
    //                     res(0);
    //                 } else if (count > 15) {
    //                     // 错误了
    //                     throw Error("传送错误");
    //                 }
    //             }, 1000);
    //         });
    //     },
    //     20 * 1000,
    // );
    // it(
    //     "测试给某条信息加个emoji",
    //     async () => {
    //         await page.waitForSelector(".timeline__wrapper");
    //         await page.hover(".timeline__wrapper>div:last-child");
    //         await page.waitForSelector(".timeline__wrapper");
    //         await page.$eval(".timeline__wrapper>div:last-child .message__options button", (el) => {
    //             el.click();
    //         });
    //         await page.waitForSelector(".emoji-board .emoji-row span");
    //         const clickAlt = await page.$eval(".emoji-board .emoji-row span img", (el) => {
    //             return el.alt;
    //         });
    //         await page.$eval(".emoji-board .emoji-row span img", (el) => {
    //             el.click();
    //         });
    //         let t: number;
    //         let count = 0;
    //         await new Promise((res) => {
    //             t = setInterval(async () => {
    //                 count += 1;
    //                 let imgalt = "";
    //                 try {
    //                     imgalt = await page.$eval(".timeline__wrapper>div:last-child .message__reactions img", (el) => {
    //                         return el.alt;
    //                     });
    //                 } catch (e) {}
    //                 if (imgalt === clickAlt) {
    //                     clearInterval(t);
    //                     res(0);
    //                 } else if (count > 15) {
    //                     // 错误了
    //                     throw Error("添加emoji错误");
    //                 }
    //             }, 1000);
    //         });
    //     },
    //     20 * 1000,
    // );
    // it(
    //     "回复某人的信息",
    //     async () => {
    //         await page.waitForSelector(".timeline__wrapper");
    //         await page.hover(".timeline__wrapper>div:last-child");
    //         await page.waitForSelector(".timeline__wrapper");
    //         await page.$eval(".timeline__wrapper>div:last-child .message__options button:nth-child(2)", (el) => {
    //             el.click();
    //         });
    //         await page.waitForTimeout(0.5 * 1000);

    //         const text = `我的回复哈哈哈哈哈${Math.random()}`;
    //         await page.$eval(".room-input__input-container textarea", async (el) => {
    //             el.focus();
    //         });
    //         await page.keyboard.type(text);
    //         await page.waitForTimeout(0.5 * 1000);
    //         await page.keyboard.press("Enter");
    //         let t: number;
    //         let count = 0;
    //         await new Promise((res) => {
    //             t = setInterval(async () => {
    //                 let name = "";
    //                 try {
    //                     name = await page.$eval(".timeline__wrapper>div:last-child .message__body div", (el) => {
    //                         return el.innerText;
    //                     });
    //                 } catch (e) {}
    //                 if (name === text) {
    //                     clearInterval(t);
    //                     res(0);
    //                 } else if (count > 10) {
    //                     expect(name).toEqual(text);
    //                     clearInterval(t);

    //                     // 错误了
    //                     throw Error("传送错误");
    //                 }
    //                 count += 1;
    //             }, 1000);
    //         });
    //     },
    //     20 * 1000,
    // );

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
            let resultName = await page.$eval(".people-selector__container .people-selector p", (el) => {
                return el.innerText;
            });
            expect(name).toContain(resultName);
            await page.$eval(".people-drawer__sticky .people-search input", (el) => {
                el.value = "";
                el.focus();
            });
            await page.keyboard.type(pubkey + "111");
            resultName = await page.$eval(".people-drawer__noresult p", (el) => {
                return el.innerText;
            });
            expect(resultName).toEqual("No results found!");
            await page.$eval(".people-drawer__sticky .people-search input", (el) => {
                el.value = "";
                el.focus();
            });
            await page.keyboard.type(name);
            resultName = await page.$eval(".people-drawer__noresult p", (el) => {
                return el.innerText;
            });
            expect(name).toContain(resultName);
        },
        20 * 1000,
    );
});
