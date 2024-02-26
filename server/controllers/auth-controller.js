import bcryptjs from "bcryptjs"
import { pool } from "../config/db.js"
import { loginSchema, rescuerSchema } from "../lib/schemas.js"
import { filterObject, generateToken, hashPassword } from "../lib/utils.js"

/**
 * @route POST /auth/rescuer/create
 * @description Creates a new rescuer
 * @access public
 * @requires id (autogenerated), name, phone, email, city, state, country, skills
 */

export async function createNewRescuer(req, res) {
  try {
    const parsedBody = rescuerSchema.safeParse(req.body)
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error })
    }
    const rescuer = parsedBody.data

    const isRescuerPresentQuery = `
      SELECT
        CASE
          WHEN COUNT(*) > 0 THEN true
          ELSE false
        END
      FROM rescuer WHERE email = $1
      `

    const rescuerQuery =
      "INSERT INTO rescuer (id, name, phone, email, password, city, state, country) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *"

    const rescuerSkillQuery =
      "INSERT INTO rescuer_skills (rescuer_id, skill_id) VALUES ($1, (SELECT id FROM skills WHERE skill= $2 )) RETURNING *"

    const isRescuerPresent = await pool.query(isRescuerPresentQuery, [
      rescuer.email,
    ])

    if (isRescuerPresent.rows[0].case) {
      return res.status(400).json({ error: "Email already registered" })
    }

    // This needs to be awaited otherwise it returns promise
    const hashedPassword = await hashPassword(rescuer.password)

    // Inserts the rescuer
    const rescuerResult = await pool.query(rescuerQuery, [
      rescuer.id,
      rescuer.name,
      rescuer.phone,
      rescuer.email,
      hashedPassword,
      rescuer.city.toLowerCase(),
      rescuer.state.toLowerCase(),
      rescuer.country.toLowerCase(),
    ])

    if (!rescuerResult) {
      return res.status(400).json({ error: "Error creating rescuer" })
    }

    // Goes through all the skills and sends query to insert them individually in rescuer_skills table
    if (rescuer.skills) {
      for (const skill of rescuer.skills) {
        const skill_result = await pool.query(rescuerSkillQuery, [
          rescuer.id,
          skill,
        ])
        if (!skill_result) {
          return res
            .status(400)
            .json({ error: "Error creating rescuer skills" })
        }
      }
    }

    res.status(201).json({
      message: "Rescuer created successfully",
      rescuer: filterObject(rescuerResult.rows[0], ["password"]),
    })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}

/**
 * @route POST /auth/login/:type
 * @param {string} type - Type of user (rescuer, authority, organization) default rescuer
 * @description Logs in to rescuer, authority, organization
 * @access public
 * @requires email, password
 */

export async function login(req, res) {
  try {
    const body = { ...req.body, type: req.params.type }

    const parsedBody = loginSchema.safeParse(body)
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error })
    }
    const loginCreds = parsedBody.data

    const query = `SELECT * FROM ${loginCreds.type} WHERE email = $1`

    const user = await pool.query(query, [loginCreds.email])
    if (!user.rows[0]) {
      return res
        .status(400)
        .json({ error: `Email is not registered as ${loginCreds.type}.` })
    }

    const isPasswordCorrect = await bcryptjs.compare(
      loginCreds.password,
      user.rows[0].password
    )

    if (!isPasswordCorrect) {
      return res.status(400).json({ error: "Invalid credentials" })
    }

    const _user = filterObject(user.rows[0], ["password"])
    const token = generateToken({
      email: loginCreds.email,
      type: loginCreds.type,
    })

    res
      .cookie("access_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      })
      .status(200)
      .json({
        message: "Logged in successfully",
        user: _user,
      })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}

/**
 * @route GET /auth/logout
 * @description Logs out the user
 * @access private
 */

export async function logout(req, res) {
  res.clearCookie("access_token").json({ message: "Logged out successfully" })
}
