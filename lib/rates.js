const axios = require("axios");
const fs = require("fs");

let binance = require("./binance")();

let fetchRates;
(fetchRates = async () => {
  let date, fx;

  try {
    ({ date, fx } = JSON.parse(fs.readFileSync("fx")));
  } catch {
    l.warn("Failed to read fx file");
  }

  let today = JSON.stringify(new Date())
    .replace(/T.*/, "")
    .replace(/"/, "");

  if (date !== today) {
    try {
      let {
        data: { rates: fx }
      } = await axios.get("https://api.exchangerate.host/latest?base=USD");
      fs.writeFileSync("fx", JSON.stringify({ date, fx }));
    } catch (e) {
      try {
        let {
          data: { rates: fx }
        } = await axios.get(`http://data.fixer.io/api/latest?access_key=${config.fixer}`);
        let USD = fx["USD"];
        Object.keys(fx).map(k => {
          fx[k] = parseFloat((fx[k] / fx["USD"]).toFixed(6));
        });
        fs.writeFileSync("fx", JSON.stringify({ date, fx }));
      } catch (e) {
        l.error("error fetching rates", e.message);
      }
    }
  }

  app.set("fx", fx);

  setTimeout(fetchRates, 7200000);
})();

setInterval(() => {
  broadcast("rate", app.get("last"));
}, 1000);

setInterval(() => {
  binance.terminate();
  binance = require("./binance")();
}, 360000);
