const bolt11 = require("bolt11");

module.exports = async (req, res) => {
  let hash = req.body.payreq;
  let payreq = bolt11.decode(hash);
  let { route } = req.body;
  let { user } = req;

  l.info("attempting lightning payment", user.username, payreq.satoshis);

  if (seen.includes(hash)) {
    l.warn("attempted to pay a paid invoice", user.username);
    return res.status(500).send("Invoice has been paid, can't pay again");
  }

  try {
    await db.transaction(async transaction => {
      let { balance } = await db.User.findOne(
        {
          where: {
            username: user.username
          }
        },
        { transaction }
      );

      if (balance < payreq.satoshis) {
        throw new Error("insufficient funds");
      }

      user.balance -= payreq.satoshis;
      await user.save({ transaction });
    });
  } catch (e) {
    l.warn(
      "insufficient funds for lightning payment",
      user.username,
      user.balance
    );
    return res.status(500).send("Not enough satoshis");
  }

  let m;
  try {
    let paymentHash = payreq.tags.find(t => t.tagName === "payment_hash").data;
    m = await lna.sendPaymentSync({
      payment_request: hash
    });

    if (m.payment_error) return res.status(500).send(m.payment_error);

    if (seen.includes(m.payment_preimage)) {
      l.warn("duplicate payment detected", m.payment_preimage);
      return res.status(500).send("duplicate payment detected");
    }

    let total = parseInt(m.payment_route.total_amt);
    let fee = m.payment_route.total_fees;

    const account = await db.Account.findOne({
      where: {
        user_id: user.id,
        asset: config.liquid.btcasset
      }
    });

    account.balance -= total - payreq.satoshis;
    await account.save()

    let payment = await db.Payment.create({
      amount: -total,
      account_id: account.id,
      user_id: user.id,
      hash,
      rate: app.get("rates")[user.currency],
      currency: user.currency,
      confirmed: true,
      network: "LNBTC"
    });

    payment = payment.get({ plain: true });
    payment.account = account.get({ plain: true });

    seen.push(m.payment_preimage);
    l.info("sent lightning", user.username, -payment.amount);

    user = await getUser(user.username);
    emit(user.username, "user", user);

    if (payreq.payeeNodeKey === config.lnb.id) {
      lna.addInvoice({ value: payreq.satoshis }, (err, invoice) => {
        let payback = lnb.sendPayment(lnb.meta, {});

        /* eslint-disable-next-line */
        let { payment_request } = invoice;
        /* eslint-disable-next-line */
        payback.write({ payment_request });
      });
    }

    seen.push(hash);
    res.send(payment);
  } catch (e) {
    l.info("error sending lightning", e.message);
    return res.status(500).send(e);
  }
};
