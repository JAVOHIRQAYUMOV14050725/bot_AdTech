export function formatDepositIntentMessage(params: {
    amount: string;
    paymentUrl: string | null | undefined;
    correlationId: string;
}): { message: string; hasPaymentUrl: boolean } {
    const trimmedUrl = params.paymentUrl?.trim();
    const hasPaymentUrl =
        Boolean(trimmedUrl) && trimmedUrl?.toLowerCase() !== 'pending';

    if (hasPaymentUrl) {
        return {
            message: `✅ Deposit intent created\nAmount: $${params.amount}\n👉 Pay here: ${trimmedUrl}`,
            hasPaymentUrl: true,
        };
    }

    return {
        message: `Payment temporarily unavailable. Error ID: ${params.correlationId} — please retry later.`,
        hasPaymentUrl: false,
    };
}
