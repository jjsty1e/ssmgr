const log4js = require('log4js');
const logger = log4js.getLogger('alipay');
const cron = appRequire('init/cron');
const config = appRequire('services/config').all();
const alipayf2f = require('alipay-ftof');
const email = appRequire('plugins/email/index');
const checkAccount = appRequire('plugins/account/checkAccount');
const inviteModel = appRequire('plugins/invite/index');

let alipay_f2f;
if(config.plugins.alipay && config.plugins.alipay.use) {
  alipay_f2f = new alipayf2f({
    appid: config.plugins.alipay.appid,
    notifyUrl: config.plugins.alipay.notifyUrl,
    merchantPrivateKey: '-----BEGIN RSA PRIVATE KEY-----\n' + config.plugins.alipay.merchantPrivateKey + '\n-----END RSA PRIVATE KEY-----',
    alipayPublicKey: '-----BEGIN PUBLIC KEY-----\n' + config.plugins.alipay.alipayPublicKey + '\n-----END PUBLIC KEY-----',
    gatewayUrl: config.plugins.alipay.gatewayUrl,
  });
}

const knex = appRequire('init/knex').knex;
const account = appRequire('plugins/account/index');
const moment = require('moment');
const push = appRequire('plugins/webgui/server/push');

const createOrder = async (user, account, amount, orderType = 3) => {
  const oldOrder = await knex('alipay').select().where({
    user,
    account: account ? account : null,
    amount: amount + '',
    orderType,
  }).where('expireTime', '>', Date.now() + 15 * 60 * 1000).where({
    status: 'CREATE',
  }).then(success => {
    return success[0];
  });
  if(oldOrder) {
    return {
      orderId: oldOrder.orderId,
      qrCode: oldOrder.qrcode,
    };
  }
  const orderId = moment().format('YYYYMMDDHHmmss') + Math.random().toString().substr(2, 6);
  const time = 60;
  const orderSetting = await knex('webguiSetting').select().where({
    key: 'payment',
  }).then(success => {
    if(!success.length) {
      return Promise.reject('settings not found');
    }
    success[0].value = JSON.parse(success[0].value);
    return success[0].value;
  }).then(success => {
    if(orderType === 5) { return success.hour; }
    else if(orderType === 4) { return success.day; }
    else if(orderType === 2) { return success.week; }
    else if(orderType === 3) { return success.month; }
    else if(orderType === 6) { return success.season; }
    else if(orderType === 7) { return success.year; }    
  });
  const qrCode = await alipay_f2f.createQRPay({
    tradeNo: orderId,
    subject: orderSetting.orderName || 'ss续费',
    totalAmount: +amount,
    body: 'ss',
    timeExpress: 10,
  });
  await knex('alipay').insert({
    orderId,
    orderType,
    qrcode: qrCode.qr_code,
    amount: amount + '',
    user,
    account: account ? account : null,
    status: 'CREATE',
    createTime: Date.now(),
    expireTime: Date.now() + time * 60 * 1000,
  });
  logger.info(`创建订单: [${ orderId }][${ amount }][account: ${ account }]`);
  return {
    orderId,
    qrCode: qrCode.qr_code,
  };
};

/**
 * 创建临时的订单
 */
const createTmpOrder = async (userId, accountId, amount) => {
  let orderId = moment().format('YYYY-MM-DD-HH-mm-ss-') + Math.random().toString().substr(2, 6);

  if (!userId || !accountId) {
    return 'weri3ojosjdf3490jadf0sa0';
  }

  const oldOrder = await knex('alipay').select().where({
    user: userId,
    account: accountId,
    status: 'CREATE',
    amount: amount
  }).then(success => {
    if (success.length) {
      return success[0];
    }
  });

  if (oldOrder) {
    // 修改该订单的创建时间，否则很尴尬
    await knex('alipay').update({createTime: Date.now()}).where({id:oldOrder.id});
    return oldOrder.orderId;
  }

  await knex('alipay').insert({
      orderId: orderId,
      orderType: 0,
      account: accountId,
      user: userId,
      qrcode: '',
      amount: amount,
      status: 'CREATE',
      createTime: Date.now(),
  });

  return orderId;
};

/**
 * 临时支付
 */
const payTmpOrder = async (orderId) => {
  const aliOrder = await knex('alipay').select().where({orderId: orderId}).then(success => {
    if (success.length) {
      return success[0];
    }
    return Promise.reject('order not found');
  });

  if (aliOrder.status === 'FINISH') {
      return Promise.reject('order is handled!');
  }

  let amount = parseInt(aliOrder.amount), limit, addFlow;

  if (amount < 5) {
      return Promise.reject('order amount: ' + amount + ' is bad');
  } else if (amount >=5 && amount <14) {
    limit = 30;
  } else if (amount >=14 && amount <28) {
    limit = 90;
  } else if (amount >= 28 && amount < 55) {
    limit = 180;
  } else {
    limit = 365;
  }

  addFlow = 1000000000 * 20; // 每天20G

  let _limit = limit;

  const _account = await knex('account_plugin').select().where({port: aliOrder.account}).then(success => {
    if (success.length) {
      return success[0];
    }

    return Promise.reject('account not found');
  });

  let accountData = JSON.parse(_account.data), create;

  if (parseInt(accountData.create) + parseInt(accountData.limit*24*60*60*1000) < parseInt(Date.now())) {
    create = Date.now();
  } else {
    create = accountData.create;
    limit = accountData.limit + limit;
  }

  const res = await knex('account_plugin').update({
      data: JSON.stringify({
          create: create,
          flow: addFlow,
          limit: limit,
      }),
      server: null,
      remark: (_account.remark ?  _account.remark + ', ' : '')
      + moment().format('YYYY-MM-DD')
      + '付费'
      + amount
  }).where({port: aliOrder.account});

  if (!res) {
      return Promise.reject('account update error');
  }

  await knex('account_plugin').where({id:_account.id}).update({state:'running'});

  // 发送邮件
  await email.sendAccountExpiredMail(_account, '您的续期' + _limit + "天已到账！如果您的帐号是过期后续费，可能需要等待大概10分钟才能生效 \n\n https://www.greentern.net");
  await checkAccount.checkServer();
  await inviteModel.handleInvitePay(aliOrder.account, parseInt(_limit/6));

  return await knex('alipay').update({ status: 'FINISH' }).where({
    orderId: orderId,
    status: 'CREATE'
    })
};

const sendSuccessMail = async userId => {
  const emailPlugin = appRequire('plugins/email/index');
  const user = await knex('user').select().where({
    type: 'normal',
    id: userId,
  }).then(success => {
    if(success.length) {
      return success[0];
    }
    return Promise.reject('user not found');
  });
  const orderMail = await knex('webguiSetting').select().where({
    key: 'mail',
  }).then(success => {
    if(!success.length) {
      return Promise.reject('settings not found');
    }
    success[0].value = JSON.parse(success[0].value);
    return success[0].value.order;
  });
  await emailPlugin.sendMail(user.email, orderMail.title, orderMail.content);
};

/*cron.minute(async () => {
  if(!alipay_f2f) { return; }
  const orders = await knex('alipay').select().whereNotBetween('expireTime', [0, Date.now()]);
  const scanOrder = order => {
    logger.info(`order: [${ order.orderId }]`);
    if(order.status !== 'TRADE_SUCCESS' && order.status !== 'FINISH') {
      return alipay_f2f.checkInvoiceStatus(order.orderId).then(success => {
        if(success.code === '10000') {
          return knex('alipay').update({
            status: success.trade_status
          }).where({
            orderId: order.orderId,
          });
        }
      });
    } else if(order.status === 'TRADE_SUCCESS') {
      const accountId = order.account;
      const userId = order.user;
      push.pushMessage('支付成功', {
        body: `订单[ ${ order.orderId } ][ ${ order.amount } ]支付成功`,
      });
      return account.setAccountLimit(userId, accountId, order.orderType)
      .then(() => {
        return knex('alipay').update({
          status: 'FINISH',
        }).where({
          orderId: order.orderId,
        });
      }).then(() => {
        logger.info(`订单支付成功: [${ order.orderId }][${ order.amount }][account: ${ accountId }]`);
        sendSuccessMail(userId);
      }).catch(err => {
        logger.error(`订单支付失败: [${ order.orderId }]`, err);
      });
    };
  };
  for(const order of orders) {
    await scanOrder(order);
  }
}, 1);*/

const checkOrder = async (orderId) => {
  const order = await knex('alipay').select().where({
    orderId,
  }).then(success => {
    if(success.length) {
      return success[0];
    }
    return Promise.reject('order not found');
  });
  return order.status;
};

const verifyCallback = (data) => {
  const signStatus = alipay_f2f.verifyCallback(data);
  if(signStatus) {
    knex('alipay').update({
      status: data.trade_status,
      alipayData: JSON.stringify(data),
    }).where({
      orderId: data.out_trade_no,
    }).andWhereNot({
      status: 'FINISH',
    }).then();
  }
  return signStatus;
};

const orderList = async (options = {}) => {
  const where = {};
  if(options.userId) {
    where['user.id'] = options.userId;
  }
  const orders = await knex('alipay').select([
    'alipay.orderId',
    'alipay.orderType',
    'user.id as userId',
    'user.username',
    'account_plugin.port',
    'alipay.amount',
    'alipay.status',
    'alipay.alipayData',
    'alipay.createTime',
    'alipay.expireTime',
  ])
  .leftJoin('user', 'user.id', 'alipay.user')
  .leftJoin('account_plugin', 'account_plugin.id', 'alipay.account')
  .where(where)
  .orderBy('alipay.createTime', 'DESC');
  orders.forEach(f => {
    f.alipayData = JSON.parse(f.alipayData);
  });
  return orders;
};

const orderListAndPaging = async (options = {}) => {
  const search = options.search || '';
  const filter = options.filter || [];
  const sort = options.sort || 'alipay.createTime_desc';
  const page = options.page || 1;
  const pageSize = options.pageSize || 20;

  let count = knex('alipay').select();
  let orders = knex('alipay').select([
    'alipay.orderId',
    'alipay.orderType',
    'user.id as userId',
    'user.username',
    'account_plugin.port',
    'alipay.amount',
    'alipay.status',
    'alipay.alipayData',
    'alipay.createTime',
    'alipay.expireTime',
  ])
  .leftJoin('user', 'user.id', 'alipay.user')
  .leftJoin('account_plugin', 'account_plugin.id', 'alipay.account');

  if(filter.length) {
    count = count.whereIn('alipay.status', filter);
    orders = orders.whereIn('alipay.status', filter);
  }
  if(search) {
    count = count.where('alipay.orderId', 'like', `%${ search }%`);
    orders = orders.where('alipay.orderId', 'like', `%${ search }%`);
  }

  count = await count.count('orderId as count').then(success => success[0].count);
  orders = await orders.orderBy(sort.split('_')[0], sort.split('_')[1]).limit(pageSize).offset((page - 1) * pageSize);
  orders.forEach(f => {
    f.alipayData = JSON.parse(f.alipayData);
  });
  const maxPage = Math.ceil(count / pageSize);
  return {
    total: count,
    page,
    maxPage,
    pageSize,
    orders,
  };
};

/*cron.minute(() => {
  if(!alipay_f2f) { return; }
  knex('alipay').delete().where({ status: 'CREATE' }).whereBetween('createTime', [0, Date.now() - 1 * 24 * 3600 * 1000]).then();
}, 37);*/

exports.orderListAndPaging = orderListAndPaging;
exports.orderList = orderList;
exports.createOrder = createOrder;
exports.checkOrder = checkOrder;
exports.verifyCallback = verifyCallback;
exports.createTmpOrder = createTmpOrder;
exports.payTmpOrder = payTmpOrder;
