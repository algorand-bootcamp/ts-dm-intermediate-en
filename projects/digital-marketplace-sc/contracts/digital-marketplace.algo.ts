import { Contract } from '@algorandfoundation/tealscript';

type forSaleID = { owner: Address; asa: uint64; nonce: uint64 };
type forSaleInfo = { deposited: uint64; unitaryPrice: uint64 };
const forSaleMbr = 2_500 + 64 * 400;

export class DigitalMarketplace extends Contract {
  forSaleBoard = BoxMap<forSaleID, forSaleInfo>();

  // This method can be called by any user by design.
  // This allows anyone to put any asset for sale without third party authorization.
  // This unfortunately means that the user essentially loses their mbr credit
  //  because other sales may be happening for the same asset preventing it from being opted out of.
  // More advanced strategies around this are possible using rekeyed accounts.
  allowAsset(mbrPay: PayTxn, asset: AssetID) {
    assert(!this.app.address.isOptedInToAsset(asset));

    verifyPayTxn(mbrPay, {
      receiver: this.app.address,
      amount: globals.assetOptInMinBalance,
    });

    sendAssetTransfer({
      xferAsset: asset,
      assetAmount: 0,
      assetReceiver: this.app.address,
    });
  }

  firstDeposit(mbrPay: PayTxn, xfer: AssetTransferTxn, nonce: uint64, unitaryPrice: uint64) {
    assert(!this.forSaleBoard({ owner: this.txn.sender, asa: xfer.xferAsset.id, nonce: nonce }).exists);

    verifyPayTxn(mbrPay, {
      sender: this.txn.sender,
      receiver: this.app.address,
      amount: forSaleMbr,
    });

    verifyAssetTransferTxn(xfer, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      assetAmount: { greaterThan: 0 },
    });

    this.forSaleBoard({ owner: this.txn.sender, asa: xfer.xferAsset.id, nonce: nonce }).value = {
      deposited: xfer.assetAmount,
      unitaryPrice: unitaryPrice,
    };
  }

  deposit(xfer: AssetTransferTxn, nonce: uint64) {
    assert(this.forSaleBoard({ owner: this.txn.sender, asa: xfer.xferAsset.id, nonce: nonce }).exists);

    verifyAssetTransferTxn(xfer, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      assetAmount: { greaterThan: 0 },
    });

    const currentDeposited = this.forSaleBoard({ owner: this.txn.sender, asa: xfer.xferAsset.id, nonce: nonce }).value
      .deposited;
    const currentUnitaryPrice = this.forSaleBoard({ owner: this.txn.sender, asa: xfer.xferAsset.id, nonce: nonce })
      .value.unitaryPrice;
    this.forSaleBoard({ owner: this.txn.sender, asa: xfer.xferAsset.id, nonce: nonce }).value = {
      deposited: currentDeposited + xfer.assetAmount,
      unitaryPrice: currentUnitaryPrice,
    };
  }

  setPrice(asset: uint64, nonce: uint64, unitaryPrice: uint64) {
    const currentDeposited = this.forSaleBoard({ owner: this.txn.sender, asa: asset, nonce: nonce }).value.deposited;
    this.forSaleBoard({ owner: this.txn.sender, asa: asset, nonce: nonce }).value = {
      deposited: currentDeposited,
      unitaryPrice: unitaryPrice,
    };
  }

  withdraw(asset: AssetID, nonce: uint64) {
    const currentDeposited = this.forSaleBoard({ owner: this.txn.sender, asa: asset.id, nonce: nonce }).value.deposited;
    this.forSaleBoard({ owner: this.txn.sender, asa: asset.id, nonce: nonce }).delete();

    sendPayment({
      receiver: this.txn.sender,
      amount: forSaleMbr,
    });

    sendAssetTransfer({
      xferAsset: asset,
      assetReceiver: this.txn.sender,
      assetAmount: currentDeposited,
    });
  }

  buy(owner: Address, asset: AssetID, nonce: uint64, buyPay: PayTxn, quantity: uint64) {
    const currentDeposited = this.forSaleBoard({ owner: owner, asa: asset.id, nonce: nonce }).value.deposited;
    const currentUnitaryPrice = this.forSaleBoard({ owner: owner, asa: asset.id, nonce: nonce }).value.unitaryPrice;

    const amountToBePaid = wideRatio([currentUnitaryPrice, quantity], [10 ** asset.decimals]);

    verifyPayTxn(buyPay, {
      sender: this.txn.sender,
      receiver: owner,
      amount: amountToBePaid,
    });

    sendAssetTransfer({
      xferAsset: asset,
      assetReceiver: this.txn.sender,
      assetAmount: quantity,
    });

    this.forSaleBoard({ owner: owner, asa: asset.id, nonce: nonce }).value = {
      deposited: currentDeposited - quantity,
      unitaryPrice: currentUnitaryPrice,
    };
  }
}
