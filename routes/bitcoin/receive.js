const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const { Op } = require("sequelize");

const bitcoin = require("bitcoinjs-lib");

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.bitcoin.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect(config.bitcoin.zmqrawtx);
zmqRawTx.subscribe("rawtx");

const network =
  bitcoin.networks[
    config.bitcoin.network === "mainnet" ? "bitcoin" : config.bitcoin.network
  ];

zmqRawTx.on("message", async (topic, message, sequence) => {
  const hex = message.toString("hex");
  let tx = bitcoin.Transaction.fromHex(message);
  let hash = reverse(tx.getHash()).toString("hex");

  if (payments.includes(hash)) return;

  Promise.all(
    tx.outs.map(async o => {
      const { value } = o;

      let address;
      try {
        address = bitcoin.address.fromOutputScript(o.script, network);
      } catch (e) {
        return;
      }

      if (Object.keys(addresses).includes(address)) {
        payments.push(hash);

        let user = await db.User.findOne({
          where: {
            username: addresses[address]
          }
        });

        const invoice = await db.Invoice.findOne({
          where: {
            user_id: user.id,
            network: "BTC"
          },
          order: [["id", "DESC"]]
        });

        const currency = invoice ? invoice.currency : user.currency;
        const rate = invoice ? invoice.rate : app.get("rates")[user.currency];
        const tip = invoice ? invoice.tip : null;

        let confirmed = false;

        const account = await db.Account.findOne({
          where: {
            user_id: user.id,
            asset: config.liquid.btcasset
          }
        });

        account.pending += value;
        await account.save();

        user.address = await bc.getNewAddress("", "bech32");
        await user.save();

        addresses[user.address] = user.username;

        let totalOutputs = tx.outs.reduce((a, b) => a + b.value, 0);
        let totalInputs = 0;
        for (let i = 0; i < tx.ins.length; i++) {
          let { hash, index } = tx.ins[i];
          hash = reverse(hash).toString("hex");
          let hex = await bc.getRawTransaction(hash.toString('hex'));
          let inputTx = bitcoin.Transaction.fromHex(hex);
          totalInputs += inputTx.outs[index].value;
        } 
        let fee = totalInputs - totalOutputs;

        let payment = await db.Payment.create({
          account_id: account.id,
          user_id: user.id,
          hash,
          fee,
          amount: value - tip,
          currency,
          rate,
          received: true,
          tip,
          confirmed,
          address,
          network: "BTC"
        });
        payment = payment.get({ plain: true });
        payment.account = account.get({ plain: true });

        user = await getUser(user.username);
        emit(user.username, "payment", payment);
        emit(user.username, "user", user);
        l.info("bitcoin detected", user.username, o.value);
      }
    })
  );
});

let queue = {};

zmqRawBlock.on("message", async (topic, message, sequence) => {
  const payments = await db.Payment.findAll({
    where: { confirmed: false }
  });

  const hashes = payments.map(p => p.hash);

  let block = bitcoin.Block.fromHex(message.toString("hex"));
  block.transactions.map(tx => {
    let hash = reverse(tx.getHash()).toString("hex");
    if (hashes.includes(hash)) queue[hash] = 1;
  });
});

setInterval(async () => {
  let arr = Object.keys(queue);
  for (let i = 0; i < arr.length; i++) {
    let hash = arr[i];

    let p = await db.Payment.findOne({
      where: { hash, confirmed: 0, received: 1 },
      include: {
        model: db.Account,
        as: "account"
      }
    });

    if (p) {
      p.confirmed = 1;
      p.account.balance += p.amount + p.tip;
      p.account.pending -= Math.min(p.account.pending, p.amount + p.tip);

      await p.account.save();
      await p.save();

      let user = await getUserById(p.user_id);
      emit(user.username, "user", user);
      emit(user.username, "payment", p);
      l.info("bitcoin confirmed", user.username, p.amount, p.tip);
      delete queue[hash];
    } else {
      l.warn("Couldn't find payment", hash);
    } 
  }
}, 1000);