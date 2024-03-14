# Custom Slider Captcha Demo

This demo code is made to demonstrate how 2Captcha API can be used to bypass custom slider captchas.


## Concept
To solve the custom slider captcha we need to calculate the path where we should drag the slider. In most cases all we need is just two points: start and end, and the start point is usually static, so we can find it just once. The second point can be found by human workers of 2Captcha, we can show them an image and provide instructions describing which exact point they need to indicate, they will click the point and 2Captcha API will return the coordinates of this point. The API method we need is [Coordinates](https://2captcha.com/api-docs/coordinates).

## Approach

To interact with the captcha we must use a browser and a framework that allows us to control the browser. In this example, we'll use [Puppeteer](https://pptr.dev/) as a browser automation framework. And we'll also use [2captcha-ts](https://www.npmjs.com/package/2captcha-ts) to interact with 2Captcha API.

### Prepare the environment

Install the dependencies:

```sh
yarn add puppeteer 2captcha-ts
```

Set the API key as an environment variable:

```sh
export APIKEY=your_api_key_here
```

### Code

As we use ES6 `import` statements in the code, let's add the following property to the `package.json` file:

```json
"type": "module"
```

Create a file named `index.js` and let's start to add some code:

First of all, let's import the dependencies

```js
import puppeteer from 'puppeteer'
import { Solver } from '2captcha-ts'
import { readFile } from 'node:fs/promises'
```

Then let's create a new instance of `Solver` with our API key

```js
const solver = new Solver(process.env.APIKEY)
```

We'll need to generate some random numbers, so let's add a simple one-liner that will do that job:

```js
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
```

The rest of the code will be wrapped into a self-executing async function as it's much more convenient to call all Promise-based Puppeeter methods with `async/await`.

```js
(async () => {
 // the rest of the code
})();
```

Let's launch a browser, get the opened tab and open the captcha demo page. We also define a variable `success` that will hold the captcha bypass process state.

```js
const browser = await puppeteer.launch({
    devtools: true,
    slowMo: 11
})
const [page] = await browser.pages()

await page.goto('https://www.jqueryscript.net/demo/image-puzzle-slider-captcha/')

let success = false
```

There's never a 100% guarantee that we'll bypass the captcha from the 1st attempt, so let's start a loop. We'll exit the loop once the captcha is successfully solved.

The demo page shows a cookies consent modal window for some countries, so let's decline all cookies if the page asks us about it.

Let's also load the instruction image that will be shown to 2Captcha workers.

```js
while (!success) {
    try {
        const consentButton = await page.waitForSelector('body > div.fc-consent-root > div.fc-dialog-container > div.fc-dialog.fc-choice-dialog > div.fc-footer-buttons-container > div.fc-footer-buttons > button.fc-button.fc-cta-do-not-consent.fc-secondary-button', { timeout: 3000 })
        if (consentButton) consentButton.click()
    } catch (e) { }

    const instruction = await readFile('./imginstructions.png', { encoding: 'base64' })
```

Then we need to grab the captcha image and send it to 2Captcha API using the [Coordinates](https://2captcha.com/api-docs/coordinates) method. There's a chance that the image will fail to load, so we check the length of the data URL returned.

Once we have the image, we pass it to the corresponding method of the `Solver` instance.
The result contains an array of point coordinates. In our case, there should be only one point. We use its `x` coordinate as a distance between the left image border and the center of the target puzzle piece.

```js
const img = await page.evaluate(() => document.querySelector('canvas').toDataURL())
if (img.length < 2000) return

try {
    const res = await solver.coordinates({
        body: img,
        textinstructions: 'Puzzle center | Центр пазла',
        imginstructions: instruction
    })
    const offset = res.data[0].x       
```


Then we get the slider element and its coordinates and dimensions. We'll use its center as a starting point for our drag-and-drop action.

```js
const slider = await page.$('div.slider')

const bb = await slider.boundingBox()

const init = {
    x: bb.x + bb.width / 2,
    y: bb.y + bb.height / 2
}
```

Then we calculate the coordinates of the final point:
In our case the width of the square part of the puzzle piece is 40px, so we need to subtract half of it, as we expect to receive the center of the puzzle piece. We also use the `y` coordinate received just to avoid moving the pointer only horizontally, as we know that the captcha is tracking the path.

```js
const target = {
    x: bb.x + bb.width / 2 + parseFloat(offset) - 20,
    y: res.data[0].y
}
```

Optionally we can draw a small box on the image to see the exact point clicked by the 2Captcha worker

```js
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
```

Then we move the mouse pointer to the start point, click and hold the mouse button and move the pointer to the end point. When moving the slider we provide a random number of steps to make the path more complex because the captcha is tracking the mouse events.

```js
await page.mouse.move(init.x, init.y)
await page.mouse.down()
await page.mouse.move(target.x, target.y, {
    steps: randomInt(50, 100)
})
await page.mouse.up()
```

Finally, we are trying to understand if we were able to bypass the captcha. In our case after the solution we are redirected to another page, so we are waiting for navigation. In the case of a successful solution, we exit the loop setting the `success` variable to `true`, [reporting a correct answer](https://2captcha.com/api-docs/report-correct) to 2Captcha API, making a screenshot and closing the page and browser. In case of error (no navigation within 5 seconds) we [report an incorrect answer](https://2captcha.com/api-docs/report-incorrect) and make one more attempt to solve the captcha.

```js
try {
    await page.waitForNavigation({ timeout: 5000 })
    success = true
    await solver.goodReport(res.id)
    await page.screenshot({
        path: 'screenshot.png'
    })
    await new Promise(ok => setTimeout(() => ok(), 5000))
    await page.close()
    await browser.close()
} catch (e) {
    await solver.badReport(res.id)
}
```

As you may have noticed, the code starting from interaction with 2Captcha API is wrapped into a `try/catch` block, so we need to close this block with the `catch` as well as close our loop here.

```js
    } catch (e) {
        console.log(`Failed to solve the captcha: ${e.err}`)
    }
}
```

### Using this demo

You can just clone the repo, install  the dependencies and run it:

```sh
git clone git@github.com:2captcha/custom-slider-demo.git
yarn #or npm i
yarn start #or npm start
```

That's it, folks!