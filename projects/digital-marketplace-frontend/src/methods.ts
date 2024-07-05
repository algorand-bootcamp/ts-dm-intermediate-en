import * as algokit from '@algorandfoundation/algokit-utils'
import { DigitalMarketplaceClient } from './contracts/DigitalMarketplace'

/**
 * Create the application and opt it into the desired asset
 */
export function create(
  algorand: algokit.AlgorandClient,
  dmClient: DigitalMarketplaceClient,
  sender: string,
  setAppId: (id: number) => void,
) {
  return async () => {
    const createResult = await dmClient.create.createApplication({})

    await algorand.send.payment({
      sender,
      receiver: createResult.appAddress,
      amount: algokit.algos(0.1),
    })

    setAppId(Number(createResult.appId))
  }
}

export function sell(
  algorand: algokit.AlgorandClient,
  dmClient: DigitalMarketplaceClient,
  sender: string,
  amount: bigint,
  unitaryPrice: bigint,
) {
  return async () => {
    const assetCreateResult = await algorand.send.assetCreate({
      sender,
      total: 10_000n,
      decimals: 3,
    })

    if (!assetCreateResult.confirmation.assetIndex) {
      throw new Error()
    }

    const { appAddress } = await dmClient.appClient.getAppReference()

    const mbrPayAllowAsset = await algorand.transactions.payment({
      sender,
      receiver: appAddress,
      amount: algokit.algos(0.1),
      extraFee: algokit.algos(0.001),
    })
    await dmClient.allowAsset({
      mbrPay: mbrPayAllowAsset,
      asset: assetCreateResult.confirmation.assetIndex,
    })

    const mbrPayFirstDeposit = await algorand.transactions.payment({
      sender,
      receiver: appAddress,
      amount: algokit.microAlgos(2_500 + 400 * 112),
    })
    const xferFirstDeposit = await algorand.transactions.assetTransfer({
      assetId: BigInt(assetCreateResult.confirmation.assetIndex),
      sender,
      receiver: appAddress,
      amount: 1n,
    })
    await dmClient.firstDeposit({
      mbrPay: mbrPayFirstDeposit,
      xfer: xferFirstDeposit,
      nonce: 0,
      unitaryPrice,
    })

    const xferDeposit = await algorand.transactions.assetTransfer({
      assetId: BigInt(assetCreateResult.confirmation.assetIndex),
      sender,
      receiver: appAddress,
      amount: amount - 1n,
    })
    await dmClient.deposit({
      xfer: xferDeposit,
      nonce: 0,
    })
  }
}

export function buy(
  algorand: algokit.AlgorandClient,
  dmClient: DigitalMarketplaceClient,
  owner: string,
  asset: bigint,
  buyer: string,
  quantity: bigint,
  unitaryPrice: bigint,
) {
  return async () => {
    await algorand.send.assetOptIn({
      assetId: asset,
      sender: buyer,
    })

    const buyPay = await algorand.transactions.payment({
      sender: buyer,
      receiver: owner,
      amount: algokit.microAlgos(Number((quantity * unitaryPrice) / BigInt(1e3))),
      extraFee: algokit.algos(0.001),
    })

    await dmClient.buy({
      owner,
      asset,
      nonce: 0n,
      buyPay,
      quantity,
    })
  }
}

// export function deleteApp(dmClient: DigitalMarketplaceClient, setAppId: (id: number) => void) {
//   return async () => {
//     await dmClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.003) } })
//     setAppId(0)
//   }
// }
