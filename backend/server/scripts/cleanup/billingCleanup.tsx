import { supabaseDb } from '../../src/fetchr/base/database/supabaseDb';
import { public_users } from '@prisma/client';

const users = await supabaseDb.public_users.findMany({
  where: {
    stripe_customer_id: {
      not: null,
    },
  },
  take: 1000,
});

console.log(
  'users',
  users.find(user => user.email === 'navid@fetchr.so'),
);

const usersWithCustomerIdAndNoCustomerIdInSubscription: public_users[] = [];
const userWithCustomerIdAndNoSubscription: public_users[] = [];
const differentCustomerIdInSubscription: public_users[] = [];
await Promise.all(
  users.map(async user => {
    const subscription = await supabaseDb.subscriptions.findFirst({
      where: {
        user_id: user.id,
      },
    });
    if (subscription) {
      if (subscription.stripe_customer_id_live !== user.stripe_customer_id) {
        usersWithCustomerIdAndNoCustomerIdInSubscription.push(user);
        //   await supabaseDb.subscriptions.update({
        //     where: {
        //       user_id: user.id,
        //     },
        //     data: {
        //       stripe_customer_id_live: user.stripe_customer_id,
        //     },
        //   });
      }
    } else {
      userWithCustomerIdAndNoSubscription.push(user);
      //   await supabaseDb.subscriptions.create({
      //     data: {
      //       user_id: user.id,
      //       stripe_customer_id_live: user.stripe_customer_id,
      //     },
      //   });
    }
  }),
);

console.log(
  'usersWithCustomerIdAndNoCustomerIdInSubscription',
  usersWithCustomerIdAndNoCustomerIdInSubscription.map(user => user.email),
);
console.log(
  'userWithCustomerIdAndNoSubscription',
  userWithCustomerIdAndNoSubscription.map(user => user.email),
);
console.log(
  'differentCustomerIdInSubscription',
  differentCustomerIdInSubscription.map(user => user.email),
);
