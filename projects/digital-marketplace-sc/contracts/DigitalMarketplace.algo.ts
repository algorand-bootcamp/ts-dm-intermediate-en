import { Contract } from '@algorandfoundation/tealscript';

type forSaleID = { owner: Address; asset: AssetID; nonce: uint64 };
type forSaleInfo = {
  deposited: uint64;
  unitaryPrice: uint64;
  bidder: Address;
  bidQuantity: uint64;
  bidUnitaryPrice: uint64;
};

// key -> value === (Address, UInt64, UInt64) -> (UInt64, UInt64, Address, UInt64, UInt64)
// === (32 + 8 + 8) -> (8 + 8 + 32 + 8 + 8) === 48 -> 64 === 112 B
// 2_500 + 400 * 64 === 28_100 microALGO === 0.0281 ALGO

const forSaleMbr = 2_500 + 400 * 112;

export class DigitalMarketplace extends Contract {
  listings = BoxMap<forSaleID, forSaleInfo>();

  public allowAsset(mbrPay: PayTxn, asset: AssetID) {
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

  public firstDeposit(mbrPay: PayTxn, xfer: AssetTransferTxn, nonce: uint64, unitaryPrice: uint64) {
    assert(!this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce: nonce }).exists);

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

    this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce: nonce }).value = {
      deposited: xfer.assetAmount,
      unitaryPrice: unitaryPrice,
      bidder: globals.zeroAddress,
      bidQuantity: 0,
      bidUnitaryPrice: 0,
    };
  }

  public deposit(xfer: AssetTransferTxn, nonce: uint64) {
    assert(this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce: nonce }).exists);

    verifyAssetTransferTxn(xfer, {
      sender: this.txn.sender,
      assetReceiver: this.app.address,
      assetAmount: { greaterThan: 0 },
    });

    const currentDeposited = this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce: nonce }).value
      .deposited;
    const currentUnitaryPrice = this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce: nonce }).value
      .unitaryPrice;
    const currentBidder = this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce: nonce }).value.bidder;
    const currentBidQuantity = this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce: nonce }).value
      .bidQuantity;
    const currentBidUnitaryPrice = this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce: nonce }).value
      .bidUnitaryPrice;

    this.listings({ owner: this.txn.sender, asset: xfer.xferAsset, nonce: nonce }).value = {
      deposited: currentDeposited + xfer.assetAmount,
      unitaryPrice: currentUnitaryPrice,
      bidder: currentBidder,
      bidQuantity: currentBidQuantity,
      bidUnitaryPrice: currentBidUnitaryPrice,
    };
  }

  public setPrice(asset: AssetID, nonce: uint64, unitaryPrice: uint64) {
    const currentDeposited = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value.deposited;
    const currentBidder = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value.bidder;
    const currentBidQuantity = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value.bidQuantity;
    const currentBidUnitaryPrice = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value
      .bidUnitaryPrice;

    this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value = {
      deposited: currentDeposited,
      unitaryPrice: unitaryPrice,
      bidder: currentBidder,
      bidQuantity: currentBidQuantity,
      bidUnitaryPrice: currentBidUnitaryPrice,
    };
  }

  public buy(owner: Address, asset: AssetID, nonce: uint64, buyPay: PayTxn, quantity: uint64) {
    const currentDeposited = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.deposited;
    const currentUnitaryPrice = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.unitaryPrice;
    const currentBidder = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.bidder;
    const currentBidQuantity = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.bidQuantity;
    const currentBidUnitaryPrice = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.bidUnitaryPrice;

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

    this.listings({ owner: owner, asset: asset, nonce: nonce }).value = {
      deposited: currentDeposited - quantity,
      unitaryPrice: currentUnitaryPrice,
      bidder: currentBidder,
      bidQuantity: currentBidQuantity,
      bidUnitaryPrice: currentBidUnitaryPrice,
    };
  }

  public bid(owner: Address, asset: AssetID, nonce: uint64, bidPay: PayTxn, quantity: uint64, unitaryPrice: uint64) {
    assert(this.txn.sender.isOptedInToAsset(asset));

    const currentDeposited = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.deposited;
    const currentUnitaryPrice = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.unitaryPrice;
    assert(quantity <= currentDeposited);

    const currentBidder = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.bidder;
    if (currentBidder !== globals.zeroAddress) {
      const currentBidQuantity = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.bidQuantity;
      const currentBidUnitaryPrice = this.listings({ owner: owner, asset: asset, nonce: nonce }).value.bidUnitaryPrice;
      assert(unitaryPrice > currentBidUnitaryPrice);

      const currentBidDeposit = wideRatio([currentBidUnitaryPrice, currentBidQuantity], [10 ** asset.decimals]);
      sendPayment({
        receiver: currentBidder,
        amount: currentBidDeposit,
      });
    }

    const bidDeposit = wideRatio([unitaryPrice, quantity], [10 ** asset.decimals]);
    verifyPayTxn(bidPay, {
      sender: this.txn.sender,
      receiver: this.app.address,
      amount: bidDeposit,
    });

    this.listings({ owner: owner, asset: asset, nonce: nonce }).value = {
      deposited: currentDeposited,
      unitaryPrice: currentUnitaryPrice,
      bidder: this.txn.sender,
      bidQuantity: quantity,
      bidUnitaryPrice: unitaryPrice,
    };
  }

  public acceptBid(asset: AssetID, nonce: uint64) {
    const currentDeposited = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value.deposited;
    const currentUnitaryPrice = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value
      .unitaryPrice;
    const currentBidder = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value.bidder;
    const currentBidQuantity = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value.bidQuantity;
    const currentBidUnitaryPrice = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value
      .bidUnitaryPrice;

    assert(currentBidder !== globals.zeroAddress);

    const minQuantity = currentDeposited < currentBidQuantity ? currentDeposited : currentBidQuantity;
    sendAssetTransfer({
      xferAsset: asset,
      assetReceiver: currentBidder,
      assetAmount: minQuantity,
    });

    const currentBidDeposit = wideRatio([currentBidUnitaryPrice, currentBidQuantity], [10 ** asset.decimals]);
    sendPayment({
      receiver: this.txn.sender,
      amount: currentBidDeposit,
    });

    this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value = {
      deposited: currentDeposited - minQuantity,
      unitaryPrice: currentUnitaryPrice,
      bidder: currentBidder,
      bidQuantity: currentBidQuantity - minQuantity,
      bidUnitaryPrice: currentBidUnitaryPrice,
    };
  }

  public withdraw(asset: AssetID, nonce: uint64) {
    const currentDeposited = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value.deposited;
    const currentBidder = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value.bidder;
    const currentBidQuantity = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value.bidQuantity;
    const currentBidUnitaryPrice = this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).value
      .bidUnitaryPrice;

    if (currentBidder !== globals.zeroAddress) {
      const currentBidDeposit = wideRatio([currentBidUnitaryPrice, currentBidQuantity], [10 ** asset.decimals]);
      sendPayment({
        receiver: currentBidder,
        amount: currentBidDeposit,
      });
    }

    this.listings({ owner: this.txn.sender, asset: asset, nonce: nonce }).delete();

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
}
