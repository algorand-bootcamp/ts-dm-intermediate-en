import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import {
  makePaymentTxnWithSuggestedParamsFromObject,
  makeAssetCreateTxnWithSuggestedParamsFromObject,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  encodeUint64,
  decodeUint64,
} from 'algosdk';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import {
  algos,
  getOrCreateKmdWalletAccount,
  sendTransaction,
  getAccountAddressAsUint8Array,
} from '@algorandfoundation/algokit-utils';
import { DigitalMarketplaceClient } from '../contracts/clients/DigitalMarketplaceClient';

const fixture = algorandFixture();
algokit.Config.configure({
  populateAppCallResources: true,
  debug: true,
});

let appClient: DigitalMarketplaceClient;

describe('DigitalMarketplace', () => {
  beforeEach(fixture.beforeEach);

  let testAssetsId: (number | bigint)[];

  beforeAll(async () => {
    await fixture.beforeEach();
    const { algod, kmd } = fixture.context;
    const stableSeller = await getOrCreateKmdWalletAccount(
      { name: 'stableSellerAccount', fundWith: algos(10) },
      algod,
      kmd
    );

    appClient = new DigitalMarketplaceClient(
      {
        sender: stableSeller,
        resolveBy: 'id',
        id: 0,
      },
      algod
    );

    testAssetsId = await Promise.all(
      [new Uint8Array([0x00]), new Uint8Array([0x01])].map(async (note) => {
        const assetCreate = await sendTransaction(
          {
            transaction: makeAssetCreateTxnWithSuggestedParamsFromObject({
              from: stableSeller.addr,
              total: 10,
              decimals: 0,
              defaultFrozen: false,
              note,
              suggestedParams: await algod.getTransactionParams().do(),
            }),
            from: stableSeller,
          },
          algod
        );
        return assetCreate.confirmation!.assetIndex!;
      })
    );

    await appClient.create.createApplication({});
    await appClient.appClient.fundAppAccount(algos(0.1));
  });

  test('allowAsset', async () => {
    const { algod, kmd } = fixture.context;
    const stableSeller = await getOrCreateKmdWalletAccount({ name: 'stableSellerAccount' }, algod, kmd);
    const { appAddress } = await appClient.appClient.getAppReference();

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algod.accountAssetInformation(appAddress, Number(asset)).do()).rejects.toBeDefined();
      })
    );

    await Promise.all(
      testAssetsId.map(async (asset) => {
        const result = await appClient.allowAsset(
          {
            mbrPay: makePaymentTxnWithSuggestedParamsFromObject({
              from: stableSeller.addr,
              to: appAddress,
              amount: algos(0.1).microAlgos,
              suggestedParams: await algod.getTransactionParams().do(),
            }),
            asset,
          },
          { sendParams: { fee: algos(0.002) } }
        );

        expect(result.confirmation).toBeDefined();
      })
    );

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algod.accountAssetInformation(appAddress, Number(asset)).do()).resolves.toEqual(
          expect.objectContaining({
            'asset-holding': {
              amount: 0,
              'asset-id': Number(asset),
              'is-frozen': false,
            },
          })
        );
      })
    );
  });

  test('firstDeposit', async () => {
    const { algod, kmd } = fixture.context;
    const stableSeller = await getOrCreateKmdWalletAccount({ name: 'stableSellerAccount' }, algod, kmd);
    const { appAddress } = await appClient.appClient.getAppReference();

    const results = await Promise.all(
      [
        [testAssetsId[0], algos(1).microAlgos],
        [testAssetsId[1], algos(1).microAlgos],
      ].map(async ([asset, unitaryPrice], nonce) => {
        return appClient.firstDeposit({
          mbrPay: makePaymentTxnWithSuggestedParamsFromObject({
            from: stableSeller.addr,
            to: appAddress,
            amount: algos(0.0281).microAlgos,
            suggestedParams: await algod.getTransactionParams().do(),
          }),
          xfer: makeAssetTransferTxnWithSuggestedParamsFromObject({
            assetIndex: Number(asset),
            from: stableSeller.addr,
            to: appAddress,
            amount: 3,
            suggestedParams: await algod.getTransactionParams().do(),
          }),
          nonce,
          unitaryPrice,
        });
      })
    );

    results.map((result) => expect(result.confirmation).toBeDefined());

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algod.accountAssetInformation(appAddress, Number(asset)).do()).resolves.toEqual(
          expect.objectContaining({
            'asset-holding': {
              amount: 3,
              'asset-id': Number(asset),
              'is-frozen': false,
            },
          })
        );
      })
    );
    await Promise.all(
      testAssetsId.map(async (asset, nonce) => {
        const boxContent = await appClient.appClient.getBoxValue(
          new Uint8Array([
            ...getAccountAddressAsUint8Array(stableSeller),
            ...encodeUint64(asset),
            ...encodeUint64(nonce),
          ])
        );
        const boxDeposited = decodeUint64(boxContent.slice(0, 8), 'safe');
        const boxUnitaryPrice = decodeUint64(boxContent.slice(8, 16), 'safe');
        expect(boxDeposited).toEqual(3);
        expect(boxUnitaryPrice).toEqual(algos(1).microAlgos);
      })
    );
  });

  test('deposit', async () => {
    const { algod, kmd } = fixture.context;
    const stableSeller = await getOrCreateKmdWalletAccount({ name: 'stableSellerAccount' }, algod, kmd);
    const { appAddress } = await appClient.appClient.getAppReference();

    const results = await Promise.all(
      testAssetsId.map(async (asset, nonce) => {
        return appClient.deposit({
          xfer: makeAssetTransferTxnWithSuggestedParamsFromObject({
            assetIndex: Number(asset),
            from: stableSeller.addr,
            to: appAddress,
            amount: 1,
            suggestedParams: await algod.getTransactionParams().do(),
          }),
          nonce,
        });
      })
    );

    results.map((result) => expect(result.confirmation).toBeDefined());

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algod.accountAssetInformation(appAddress, Number(asset)).do()).resolves.toEqual(
          expect.objectContaining({
            'asset-holding': {
              amount: 4,
              'asset-id': Number(asset),
              'is-frozen': false,
            },
          })
        );
      })
    );
    await Promise.all(
      testAssetsId.map(async (asset, nonce) => {
        const boxContent = await appClient.appClient.getBoxValue(
          new Uint8Array([
            ...getAccountAddressAsUint8Array(stableSeller),
            ...encodeUint64(asset),
            ...encodeUint64(nonce),
          ])
        );
        const boxDeposited = decodeUint64(boxContent.slice(0, 8), 'safe');
        expect(boxDeposited).toEqual(4);
      })
    );
  });

  test('setPrice', async () => {
    const { algod, kmd } = fixture.context;
    const stableSeller = await getOrCreateKmdWalletAccount({ name: 'stableSellerAccount' }, algod, kmd);

    const results = await Promise.all(
      [
        [testAssetsId[0], algos(3).microAlgos],
        [testAssetsId[1], algos(5).microAlgos],
      ].map(async ([asset, unitaryPrice], nonce) => {
        return appClient.setPrice({
          asset,
          nonce,
          unitaryPrice,
        });
      })
    );

    results.map((result) => expect(result.confirmation).toBeDefined());
    await Promise.all(
      [
        [testAssetsId[0], algos(3).microAlgos],
        [testAssetsId[1], algos(5).microAlgos],
      ].map(async ([asset, unitaryPrice], nonce) => {
        const boxContent = await appClient.appClient.getBoxValue(
          new Uint8Array([
            ...getAccountAddressAsUint8Array(stableSeller),
            ...encodeUint64(asset),
            ...encodeUint64(nonce),
          ])
        );
        const boxUnitaryPrice = decodeUint64(boxContent.slice(8, 16), 'safe');
        expect(boxUnitaryPrice).toEqual(unitaryPrice);
      })
    );
  });

  // test('buy', async () => {
  //   const { testAccount, algod } = fixture.context;
  //   const { appAddress } = await appClient.appClient.getAppReference();
  //
  //   await sendTransaction(
  //     {
  //       transaction: makeAssetTransferTxnWithSuggestedParamsFromObject({
  //         assetIndex: Number(testAssetId),
  //         from: testAccount.addr,
  //         to: testAccount.addr,
  //         amount: 0,
  //         suggestedParams: await algod.getTransactionParams().do(),
  //       }),
  //       from: testAccount,
  //     },
  //     algod
  //   );
  //
  //   const result = await appClient.buy(
  //     {
  //       buyerTxn: makePaymentTxnWithSuggestedParamsFromObject({
  //         from: testAccount.addr,
  //         to: appAddress,
  //         amount: algos(6.6).microAlgos,
  //         suggestedParams: await algod.getTransactionParams().do(),
  //       }),
  //       quantity: 2,
  //     },
  //     {
  //       sender: testAccount,
  //       sendParams: {
  //         fee: algos(0.002),
  //       },
  //     }
  //   );
  //
  //   expect(result.confirmation).toBeDefined();
  //
  //   await expect(algod.accountAssetInformation(testAccount.addr, Number(testAssetId)).do()).resolves.toEqual(
  //     expect.objectContaining({
  //       'asset-holding': {
  //         amount: 2,
  //         'asset-id': Number(testAssetId),
  //         'is-frozen': false,
  //       },
  //     })
  //   );
  // });
  //
  // test('withdraw', async () => {
  //   const { algod, kmd } = fixture.context;
  //   const testAccount = await getOrCreateKmdWalletAccount({ name: 'stableSellerAccount' }, algod, kmd);
  //   const { appId } = await appClient.appClient.getAppReference();
  //
  //   const { amount: beforeCallAmount } = await algod.accountInformation(testAccount.addr).do();
  //
  //   const result = await appClient.delete.withdraw({}, { sendParams: { fee: algos(0.003) } });
  //
  //   expect(result.confirmation).toBeDefined();
  //
  //   const { amount: afterCallAmount } = await algod.accountInformation(testAccount.addr).do();
  //   // After deleting the sell contract, the account gets ALGO for what they sold, contract mbr minus txn fees.
  //   expect(afterCallAmount - beforeCallAmount).toEqual(algos(6.6 + 0.2 - 0.003).microAlgos);
  //   await expect(algod.accountAssetInformation(testAccount.addr, Number(testAssetId)).do()).resolves.toEqual(
  //     expect.objectContaining({
  //       'asset-holding': {
  //         amount: 8,
  //         'asset-id': Number(testAssetId),
  //         'is-frozen': false,
  //       },
  //     })
  //   );
  //
  //   await expect(algod.getApplicationByID(Number(appId)).do()).rejects.toBeDefined();
  // });
});
