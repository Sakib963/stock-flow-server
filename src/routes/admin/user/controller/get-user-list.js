const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_user_list = async (request, res) => {
      console.log(request.query);

      let data = null;

      data = [
            {
                  oid: 1,
                  name: "Michael Johnson",
                  email: "michael.johnson@example.com",
                  phone: "123-456-7890",
                  status: "Active",
                  designation: "Software Engineer",
                  photo: "https://via.placeholder.com/150?text=Michael+Johnson",
            },
            {
                  oid: 2,
                  name: "Aisha Khan",
                  email: "aisha.khan@example.com",
                  phone: "234-567-8901",
                  status: "Inactive",
                  designation: "Project Manager",
                  photo: "https://via.placeholder.com/150?text=Aisha+Khan",
            },
            {
                  oid: 3,
                  name: "Carlos Martinez",
                  email: "carlos.martinez@example.com",
                  phone: "345-678-9012",
                  status: "Active",
                  designation: "QA Engineer",
                  photo: "https://via.placeholder.com/150?text=Carlos+Martinez",
            },
            {
                  oid: 4,
                  name: "Yuki Tanaka",
                  email: "yuki.tanaka@example.com",
                  phone: "456-789-0123",
                  status: "Active",
                  designation: "Team Lead",
                  photo: "https://via.placeholder.com/150?text=Yuki+Tanaka",
            },
            {
                  oid: 5,
                  name: "Emily Davis",
                  email: "emily.davis@example.com",
                  phone: "567-890-1234",
                  status: "Inactive",
                  designation: "Business Analyst",
                  photo: "https://via.placeholder.com/150?text=Emily+Davis",
            },
            {
                  oid: 6,
                  name: "Raj Patel",
                  email: "raj.patel@example.com",
                  phone: "678-901-2345",
                  status: "Active",
                  designation: "HR Manager",
                  photo: "https://via.placeholder.com/150?text=Raj+Patel",
            },
            {
                  oid: 7,
                  name: "Amara Okafor",
                  email: "amara.okafor@example.com",
                  phone: "789-012-3456",
                  status: "Active",
                  designation: "UI/UX Designer",
                  photo: "https://via.placeholder.com/150?text=Amara+Okafor",
            },
            {
                  oid: 8,
                  name: "Liam Green",
                  email: "liam.green@example.com",
                  phone: "890-123-4567",
                  status: "Inactive",
                  designation: "DevOps Engineer",
                  photo: "https://via.placeholder.com/150?text=Liam+Green",
            },
            {
                  oid: 9,
                  name: "Fatima Ahmed",
                  email: "fatima.ahmed@example.com",
                  phone: "901-234-5678",
                  status: "Active",
                  designation: "Data Scientist",
                  photo: "https://via.placeholder.com/150?text=Fatima+Ahmed",
            },
            {
                  oid: 10,
                  name: "Noah Kim",
                  email: "noah.kim@example.com",
                  phone: "012-345-6789",
                  status: "Active",
                  designation: "Backend Developer",
                  photo: "https://via.placeholder.com/150?text=Noah+Kim",
            },
            {
                  oid: 11,
                  name: "Isabella Lopez",
                  email: "isabella.lopez@example.com",
                  phone: "123-456-7891",
                  status: "Inactive",
                  designation: "Frontend Developer",
                  photo: "https://via.placeholder.com/150?text=Isabella+Lopez",
            },
            {
                  oid: 12,
                  name: "James Okoro",
                  email: "james.okoro@example.com",
                  phone: "234-567-8902",
                  status: "Active",
                  designation: "System Administrator",
                  photo: "https://via.placeholder.com/150?text=James+Okoro",
            },
            {
                  oid: 13,
                  name: "Leila Zhang",
                  email: "leila.zhang@example.com",
                  phone: "345-678-9013",
                  status: "Inactive",
                  designation: "Content Strategist",
                  photo: "https://via.placeholder.com/150?text=Leila+Zhang",
            },
            {
                  oid: 14,
                  name: "David Brown",
                  email: "david.brown@example.com",
                  phone: "456-789-0124",
                  status: "Active",
                  designation: "Marketing Specialist",
                  photo: "https://via.placeholder.com/150?text=David+Brown",
            },
            {
                  oid: 15,
                  name: "Ava Nakamura",
                  email: "ava.nakamura@example.com",
                  phone: "567-890-1235",
                  status: "Active",
                  designation: "Product Manager",
                  photo: "https://via.placeholder.com/150?text=Ava+Nakamura",
            },
      ];

      /* try {
            let data_set = await get_data(sql);
            data = data_set.length ? null : data_set;

            log.info(`User info Found: ${data?.email}`)
            return res.status(200).json({
                  code: 200, message: "User info Found", data
            });
      } catch (e) {
            log.error(`An exception occurred while getting user information : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      } */

      log.info(`User list Found: ${data?.length}`)
      return res.status(200).json({
            code: 200, message: "User list Found", data
      });
}

module.exports = get_user_list