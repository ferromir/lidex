# Lidex

![Build and test](https://github.com/ferromir/lidex/actions/workflows/build-and-test.yml/badge.svg)

Lidex is a lightweight durable execution library that allows you to write and execute workflows.

## Features

### Lightweight
No additional services are required. Your Node.js app can start workflows and also execute them.

### Scalable
Scale horizontally by adding simply more instances of your service so you can process more workflows.

### Powered by MongoDB
Workflow state is stored in MongoDB. If your application already uses MongoDB you don't even have to add additional database infrastructure.

### Minimalistic
It adds a minimal of features to implement a realiable durable execution solution. It implements start, step and sleep only.

### Typed
Written in TypeScript, types provided in the package.

## Install
```bash
npm install lidex
```

## Basic usage

Writting a workflow.
```TypeScript
async collectPayment(ctx: Context, invoiceId: string): Promise<void> {
  const invoice = await ctx.step("find-invoice", async () => {
    return await this.invoiceRepo.find(invoiceId);
  });

  if (!invoice) {
    return;
  }

  const account = await ctx.step("find-account", async () => {
    console.log("executing find-account...");
    return await this.accountRepo.find(invoice.accountId);
  });

  if (!account) {
    return;
  }

  for (let i = 0; i < 3; i++) {
    const success = await ctx.step(`capture-payment-${i}`, async () => {
      return await this.paymentApi.capture(
        account.paymentToken,
        invoice.amount,
      );
    });

    if (success) {
      await ctx.step("mark-invoice-as-paid", async () => {
        await this.invoiceRepo.markAsPaid(invoice.id);
      });

      return;
    }

    await ctx.sleep(`sleep-${i}`, 86_400_000 ); // 24h
  }

  await ctx.start(`block-account-${account.id}`, "block-account", account.id);
}

```

Creating a client and start polling workflows.
```TypeScript
// Express and services setup omitted...
const handlers = new Map();

handlers.set(
  "collect-payment",
  invoiceService.collectPayment.bind(invoiceService),
);

const client = await makeClient({
  handlers,
  mongoUrl: "mongodb://localhost:27017/lidex",
  now: () => new Date(),
});

app.post("/invoices/:invoiceId/collect", async (req, res) => {
  const invoiceId = req.params.invoiceId;

  await client.start(
    `collect-payment-${invoiceId}`,
    "collect-payment",
    invoiceId,
  );

  res.send();
});

app.listen(port, () => {
  console.log(`durex app listening on port ${port}`);
});

await client.poll();
```

## The Context functions

### The step function
Every non-deterministic operation in the workflow should be executed within a step. This is at the heart of durable execution.

When a function is executed, its result is stored in the database. If the server restarts, the workflow is resumed without executing these steps and continues until the workflow is finished.

### The sleep function
Sleep is a special kind of step, one important difference is that the id and the wake-up time are stored before putting the workflow to sleep. If the server crashes, the workflow is not resumed until after the wake-up time.

### The start function
Is just a conveniently placed proxy to the client's start function. It starts a new workflow which holds no relationship to the one currently running. There is no concept of parent/child workflows in Lidex.

## The Client functions

### The start function
It starts a new workflow, it does this by creating a workflow in the database. The start function is idempotent and if it is called with the same id it will just return false instead of failing.

### The poll function
It turns the app into a worker. It starts polling workflows that are ready to be picked-up and it runs them. If it does not find any workflow to be claimed, it makes a pause for a duration that is configured.

### The wait function
A function that allows you to wait until a workflow matches a given status. It is useful for short-lived workflows that will either fail or succeed quickly and allows apps to return synchronous responses.

## Configuration object
This is the configuration required to create a client.
| Property          | Default   | Description |
--------------------|-----------|--------------
| handlers          |           | A map where the key is the handler identifier and the value is the the handler function. This is how Lidex know during runtime what function should be used to run the workflow. |
| now               |           | A function that returns current time. |
| mongoUrl          |           | The MongoDB url. |
| maxFailures       | 3         | The max amount of time a workflow can fail before changing it's status to "aborted". |
| timeoutIntervalMs | 5 minutes | The amount of milliseconds for timeouts. After timing out, a running workflow is considered ready to be picked-up by any other instance polling workflows. |
| pollIntervalMs    | 5 seconds | It defines the length of the pause between poll calls to the database when last call was empty. |