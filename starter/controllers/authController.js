const crypto = require('crypto');
const { promisify } = require('util');
// eslint-disable-next-line import/no-extraneous-dependencies
const jwt = require('jsonwebtoken');

const User = require(`./../models/userModel`);

const catchAsync = require(`./../utils/catchAsync`);

const AppError = require(`./../utils/appError`);
const sendEmail = require(`./../utils/email`);

const signToken = function (id) {
  // eslint-disable-next-line no-undef
  return jwt.sign({ id: id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
}; //jwt.sign(payload(or header), secret, expiresin) === to create the signature we use to check the jwt
// Signing up user and automatically logging in on sign up

exports.signup = catchAsync(async (req, res, _next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    passwordChangedAt: req.body.passwordChangedAt,
    passwordResetToken: req.body.passwordResetToken,
  });

  const token = signToken(newUser._id);

  res.status(201).json({
    //201 - created status
    status: 'success',
    token,
    data: {
      user: newUser,
    },
  });
});

// logging in a user on username, email and password basis
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1. Check if email and passwords exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }
  // 2.) check if user exists and passsword is correct
  const user = await User.findOne({ email }).select('+password'); //the +password is to select a field that is normally not selected for display in DB

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401)); //401-unautorized status code
  }
  // 3.) if everything is okay, send token to client
  const token = signToken(user._id);
  res.status(200).json({
    status: 'success',
    token,
  });
});

// Protecting the routes - only logged in users have access to all the routes
exports.protect = catchAsync(async (req, res, next) => {
  // 1.) Getting token and check if it is exists
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  //format for token check using headers key(authorization) and value(starter with 'Bearer token') in postman for JWT

  if (!token) {
    return next(
      new AppError(
        'You are not currently logged in! Please log in to get access.',
        401
      )
    );
  }
  // 2.) Verification of token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3.)  Check if user still exists
  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(
      new AppError('The User belonging to this token does no longer exist', 401)
    );
  }
  // 4.) check if user changed password after the token was issued
  if (currentUser.changePasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please Login again!', 401)
    );
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = currentUser;
  next();
});

// User roles and permissions for deleting tours
// eslint-disable-next-line arrow-body-style
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // roles ['admin', 'lead-guide'], rple='user'
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      ); //403 = forbidden
    }
    next();
  };
};

//Password reset Functionality
exports.forgotPassword = catchAsync(async (req, res, next) => {
  // 1.) Get user based on posted email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new AppError('There is no user with this email address', 404));
  }
  // 2.) Generate the random token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false }); //used to deactivate all the validators we set in our schema

  // 3>) Send it back as an email
  const resetURL = `${req.protocol}://${req.get(
    'host'
  )}/api/v1/users/this.resetPassword/${resetToken}`;

  const message = `Forgot your password? Sumbit a PATCH request with your new password and passwordConfirm to: ${resetURL}.\nIf you didn't forget your password, please ignore this email`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your password reset token (valid for 10 min)',
      message,
    });
    res.status(200).json({
      status: 'success',
      message: 'Token sent to email!',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError(
        'There was an error sending the email. Try again later!',
        500
      )
    );
  }
});

// setting new password
exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1.) Get user based on token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });
  // 2.) If token has not expired, and there is user, set the new password
  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  // 3.) Update changedPasswordAt property for the user
  // 4.) Log the user in, send JWT
  const token = signToken(user._id);
  res.status(200).json({
    status: 'success',
    token,
  });
});
