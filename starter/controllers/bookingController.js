// eslint-disable-next-line import/no-extraneous-dependencies
const Stripe = require('stripe');
const Tour = require('../models/tourmodel');
const Booking = require('../models/bookingModel');
const AppError = require('../utils/appError');

const catchAsync = require(`./../utils/catchAsync`);
const factory = require(`./handlerFactory`);

exports.getCheckoutSession = catchAsync(async (req, res, next) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  ///////////////////////////////////
  // 1.) Get the currently booked tour
  const tour = await Tour.findById(req.params.tourID);
  //////////////////////////////
  // 2.) Create checkout session
  const product = await stripe.products.create({
    name: `${tour.name} Tour`,
    description: tour.summary,
    images: [`https://www.natours.dev/img/tours/${tour.imageCover}`],
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: tour.price * 100,
    currency: 'usd',
  });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    // For us to create the new bookings on our website after succesful payment we will use webhooks, however, this can only be done after the website has been deployed. So till we deploy this app, this is the temporary solution to that...but this process is not secure so it should not be used
    // By making a get request to the SUCCESS URL and passing a query into it to get the details of the account
    success_url: `${req.protocol}://${req.get('host')}/?tour=${
      req.params.tourID
    }&user=${req.user.id}&price=${tour.price}`,
    cancel_url: `${req.protocol}://${req.get('host')}/tour/${tour.slug}`,
    customer_email: req.user.email,
    client_reference_id: req.params.tourID,
    mode: 'payment',
    line_items: [
      {
        price: price.id,
        quantity: 1,
      },
    ],
  });
  //////////////////////////
  // 3.) Send back to client
  res.status(200).json({
    status: 'success',
    session,
  });
});

// Function that will create booking and reflect it in our database
exports.createBookingCheckout = catchAsync(async (req, res, next) => {
  //  This is only temporary because it is UNSECURE: and everyone can make bookings without paying
  ///////////

  // Get data from query string
  const { tour, user, price } = req.query;

  // if the query does not contain all 3 then we return to the next middleware
  if (!tour || !user || !price) return next();

  // using the booking schema and model we call the create function using the tour, user and price paramter
  await Booking.create({ tour, user, price });

  // res.redirect is used to redirect the original successUrl(OriginalUrl) to the URL without the query link
  // used to create a new request but to the new URL we pass into the function
  res.redirect(req.originalUrl.split('?')[0]);
});

exports.checkIfBooked = catchAsync(async (req, res, next) => {
  // To check if booked was bought by user who wants to review it
  const booking = await Booking.find({
    user: req.user.id,
    tour: req.body.tour,
  });
  if (booking.length === 0)
    return next(new AppError('You must buy this tour to review it', 401));
  next();
});

exports.createBooking = factory.createOne(Booking);
exports.getBooking = factory.getOne(Booking);
exports.getAllBookings = factory.getAll(Booking);
exports.updateBooking = factory.updateOne(Booking);
exports.deleteBooking = factory.deleteOne(Booking);
