export const validationMessages = {
    required: (field) => `${field} is required`,

    name: {
        required: "Name is required",
        minLength: "Name must be at least 2 characters",
        maxLength: "Name must not exceed 100 characters",
        invalid: "Name can contain only letters and spaces",
    },

    email: {
        required: "Email is required",
        invalid: "Please enter a valid email address",
    },

    password: {
        required: "Password is required",
        minLength: "Password must be at least 6 characters",
        maxLength: "Password must not exceed 100 characters",
        uppercase: "Password must contain at least one uppercase letter",
        lowercase: "Password must contain at least one lowercase letter",
        number: "Password must contain at least one number",
        special: "Password must contain at least one special character",
        mismatch: "Passwords do not match",
    },

    confirmPassword: {
        required: "Confirm password is required",
        mismatch: "Passwords do not match",
    },

    phone: {
        required: "Phone number is required",
        invalid: "Please enter a valid phone number",
        length: "Mobile number must be 8 to 10 digits",
    },

    message: {
        required: "Message is required",
        minLength: "Message must be at least 10 characters",
        maxLength: "Message must not exceed 500 characters",
    },

    generic: {
        invalid: "Please enter a valid value",
        somethingWentWrong: "Something went wrong. Please try again.",
        networkError: "Unable to connect to the server. Please try again.",
        serverError: "Server error. Please try again later.",
    },
};


export function validateRequired(value, fieldName) {
    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
    ) {
        return validationMessages.required(fieldName);
    }

    return "";
}


export function validateName(name) {
    if (
        name === undefined ||
        name === null ||
        String(name).trim() === ""
    ) {
        return "";
    }

    const value = name.trim();

    if (value.length < 2) {
        return validationMessages.name.minLength;
    }

    if (value.length > 100) {
        return validationMessages.name.maxLength;
    }

    if (!/^[A-Za-z\s]+$/.test(value)) {
        return validationMessages.name.invalid;
    }

    return "";
}


const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function validateEmail(email) {
  const requiredError = validateRequired(email, "Email");

  if (requiredError) {
    return requiredError;
  }

  if (!EMAIL_REGEX.test(email.trim())) {
    return validationMessages.email.invalid;
  }

  return "";
}


export function validatePassword(password) {
    const requiredError = validateRequired(
        password,
        "Password"
    );

    if (requiredError) {
        return requiredError;
    }

    if (password.length < 6) {
        return validationMessages.password.minLength;
    }

    if (password.length > 100) {
        return validationMessages.password.maxLength;
    }

    if (!/[A-Z]/.test(password)) {
        return validationMessages.password.uppercase;
    }

    if (!/[a-z]/.test(password)) {
        return validationMessages.password.lowercase;
    }

    if (!/\d/.test(password)) {
        return validationMessages.password.number;
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
        return validationMessages.password.special;
    }

    return "";
}


export function validateConfirmPassword(
    password,
    confirmPassword
) {
    const requiredError = validateRequired(
        confirmPassword,
        "Confirm password"
    );

    if (requiredError) {
        return requiredError;
    }

    if (password !== confirmPassword) {
        return validationMessages.confirmPassword.mismatch;
    }

    return "";
}


export function validatePhone(phone) {
    const requiredError = validateRequired(
        phone,
        "Phone number"
    );

    if (requiredError) {
        return requiredError;
    }

    const phoneRegex = /^[0-9]{10}$/;

    if (!phoneRegex.test(phone.trim())) {
        return validationMessages.phone.invalid;
    }

    return "";
}


// Validate a mobile number that includes a country code in E.164 form
// (+<dial><number>). The country code is ignored; only the national part
// is validated and must be 8 to 10 digits.
export function validateMobile(mobile) {
    const requiredError = validateRequired(
        mobile,
        "Mobile number"
    );

    if (requiredError) {
        return requiredError;
    }

    const value = String(mobile).trim();

    if (!/^\+[0-9]{7,14}$/.test(value)) {
        return validationMessages.phone.invalid;
    }

    // Count only national digits (exclude the leading + and country code).
    // We approximate: assume the dial code is the portion before the national.
    const nationalDigits = value.replace(/^\+/, "").match(/[1-9][0-9]*$/)?.[0] || "";

    if (
        nationalDigits.length < 8 ||
        nationalDigits.length > 10
    ) {
        return validationMessages.phone.length;
    }

    return "";
}


export function validateMessage(message) {
    const requiredError = validateRequired(
        message,
        "Message"
    );

    if (requiredError) {
        return requiredError;
    }

    const value = message.trim();

    if (value.length < 10) {
        return validationMessages.message.minLength;
    }

    if (value.length > 500) {
        return validationMessages.message.maxLength;
    }

    return "";
}