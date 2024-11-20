const jwt = require('jsonwebtoken');
const moment = require("moment-timezone");
const { get_access_token_from_db } = require('./helper');

const jwtMiddleware = async (req, res, next) => {
      try {
            // Extract and validate the token
            const authorizationHeader = req.headers['authorization'];
            if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
                  return res.status(401).json({ message: 'Unauthorized: No token provided' });
            }

            const accessToken = authorizationHeader.replace('Bearer ', '').trim();

            // Decode and verify the token
            let decodedToken;
            try {
                  decodedToken = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);
            } catch (err) {
                  return res.status(401).json({ message: 'Unauthorized: Invalid token' });
            }

            // Fetch user data based on the token
            const user = await get_access_token_from_db(accessToken);
            if (!user) {
                  return res.status(401).json({ message: 'Unauthorized: Invalid token' });
            }

            // Check user status
            if (user.status !== 'Signin') {
                  return res.status(401).json({ message: 'Unauthorized: User has already logged out' });
            }

            // Check token expiration
            const signOutTime = moment(user.signout_time, 'YYYY-MM-DD HH:mm:ss.SSS').tz('Asia/Dhaka');
            if (signOutTime.isBefore(moment())) {
                  return res.status(401).json({ message: 'Unauthorized: Token expired' });
            }

            // Attach user info from the token to the request object
            req.credentials = {
                  user_id: decodedToken.token.user_id,
            };

            next(); // Proceed to the next middleware or route handler
      } catch (error) {
            console.error('JWT Middleware Error:', error.message);
            return res.status(500).json({ message: 'Internal Server Error' });
      }
};

module.exports = jwtMiddleware;
