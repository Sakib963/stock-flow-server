const generate_batch_code = () => {
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < 3; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      result += '-';
      for (let i = 0; i < 3; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      result += '-';
      for (let i = 0; i < 5; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      return result;
}

module.exports = {
      generate_batch_code,
};