const Passport = require("passport");
const jwt = require("passport-jwt");

function cookieExtractor(req) {
  if (req && req.cookies) return req.cookies["token"];
  return null;
}

passport = Passport.use(
  new jwt.Strategy(
    {
      jwtFromRequest: jwt.ExtractJwt.fromExtractors([
        jwt.ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor
      ]),
      secretOrKey: config.jwt
    },
    async (payload, next) => {
      const { username } = payload;
      try {
        next(null, await db.User.findOne({ where: { username } }));
      } catch (e) {
        l.error("error finding user for session", e);
        next(null, { username: "guest" });
      }
    }
  )
);

auth = passport.authenticate("jwt", { session: false });
app.use(passport.initialize());