import puppeteer from 'puppeteer'
import { Solver } from '@2captcha/captcha-solver'
import { readFile } from 'node:fs/promises'

const solver = new Solver(process.env.APIKEY)

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

(async () => {
    const browser = await puppeteer.launch({
        devtools: true,
        slowMo: 11
    })
    const [page] = await browser.pages()

    await page.goto('https://www.jqueryscript.net/demo/image-puzzle-slider-captcha/')

    let success = false

    while (!success) {
        // Decline cookies if asked
        try {
            const consentButton = await page.waitForSelector('body > div.fc-consent-root > div.fc-dialog-container > div.fc-dialog.fc-choice-dialog > div.fc-footer-buttons-container > div.fc-footer-buttons > button.fc-button.fc-cta-do-not-consent.fc-secondary-button', { timeout: 3000 })
            if (consentButton) consentButton.click()
        } catch (e) { }

        // Load the instruction image
        const instruction = await readFile('./imginstructions.png', { encoding: 'base64' })

        // Get the captcha image from canvas
        const img = await page.evaluate(() => document.querySelector('canvas').toDataURL())
        if (img.length < 2000) return

        console.log('Sending the captcha to 2captcha API...')

        try {
            // Sent  the captcha to 2Captcha API
            const res = await solver.coordinates({
                body: img,
                textinstructions: 'Puzzle center | Центр пазла',
                imginstructions: instruction
            })

            console.log('Captcha solved!')
            console.log(res)

            // The value shows the distance from the left image side to the center of puzzle piece
            const offset = res.data[0].x

            // Getting the slider element
            const slider = await page.$('div.slider')

            const bb = await slider.boundingBox()

            // We use the center of the slider button as starting point
            const init = {
                x: bb.x + bb.width / 2,
                y: bb.y + bb.height / 2
            }

            // We calculate the end point coordinates where we should drag the slider
            // As the captcha on demo page tracks the path, we also move the end point a bit upper, to make the path more complex. For more complex cases we can even build a set of coordinates with randomized Y coordinate to make a path more human-like.
            const target = {
                x: bb.x + bb.width / 2 + parseFloat(offset) - 20,
                y: res.data[0].y
            }

            // As there's a canvas we can draw the point at coordinates received from 2Captcha API to visualize the result
            await page.evaluate((coord) => {
                console.log(coord)
                const canvas = document.querySelector('#captcha > canvas')
                let ctx = canvas.getContext('2d')
                ctx.globalAlpha = 1
                ctx.fillStyle = 'red'
                ctx.fillRect(coord.x, coord.y, 3, 3)
            }, {
                x: parseInt(res.data[0].x),
                y: parseInt(res.data[0].y)
            })

            // As we have all the coordinates, we can move the pointer to our starting point
            await page.mouse.move(init.x, init.y)

            // We click and hold the mouse button
            await page.mouse.down()

            // Then we move the pointer to our target point
            await page.mouse.move(target.x, target.y, {
                steps: randomInt(50, 100)
            })

            // Finally we release the mouse button
            await page.mouse.up()

            try {
                // The successfull captcha solution redirects us to another page, so we wait for navigation event
                await page.waitForNavigation({ timeout: 5000 })
                success = true
                console.log('Successfully bypassed the captcha!')
                console.log('Reporting good solution to 2Captcha API...')
                // Reporting good answer to 2Captcha API
                await solver.goodReport(res.id)
                // Making a screenshot
                await page.screenshot({
                    path: 'screenshot.png'
                })
                await new Promise(ok => setTimeout(() => ok(), 5000))
                await page.close()
                await browser.close()
            } catch (e) {
                // If we are not forwarded to other page within 5 seconds we treat this case as incorrect captcha solution
                console.log('Failed to bypass the captcha, trying one more time...')
                console.log('Reporting bad solution to 2Captcha API...')
                // Reporting bad answer to 2Captcha API
                await solver.badReport(res.id)
            }

        } catch (e) {
            console.log(`Failed to solve the captcha: ${e.err}`)
        }
    }
})();