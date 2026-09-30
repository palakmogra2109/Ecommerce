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
        length: "Mobile number must be 10 to 12 digits",
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
// (+<dial><number>). The dial code is stripped using known prefixes and
// the remaining national part must be 10 to 12 digits.
export function validateMobile(mobile) {
    const requiredError = validateRequired(
        mobile,
        "Mobile number"
    );

    if (requiredError) {
        return requiredError;
    }

    const value = String(mobile).trim();

    // Plain national digits (legacy stored numbers) validate directly;
    // +-prefixed values go through the dial-code strip below.
    if (!value.startsWith("+")) {
        const plain = value.replace(/\D/g, "");
        if (!/^\d+$/.test(plain) || plain.length < 10 || plain.length > 12) {
            return validationMessages.phone.length;
        }
        return "";
    }

    if (!/^\+[0-9]{11,16}$/.test(value)) {
        return validationMessages.phone.invalid;
    }

    // Strip the leading + and try to remove a known dial code prefix.
    // Sort by length descending so longer codes match first (e.g. +971 before +97).
    const dialCodes = [
        "+93","+355","+213","+376","+244","+54","+374","+61","+43","+994",
        "+1242","+973","+880","+1246","+375","+32","+501","+229","+975",
        "+591","+387","+267","+55","+673","+359","+226","+257","+855","+237",
        "+1","+238","+236","+235","+56","+86","+57","+269","+242","+243",
        "+506","+225","+385","+53","+357","+420","+45","+253","+593","+20",
        "+503","+240","+291","+372","+251","+358","+33","+241","+220","+995",
        "+49","+233","+30","+502","+224","+245","+592","+509","+504","+852",
        "+36","+354","+91","+62","+98","+964","+353","+972","+39","+223",
        "+81","+962","+7","+254","+82","+965","+996","+856","+371","+218",
        "+423","+370","+352","+853","+261","+265","+60","+960","+223",
        "+225","+52","+692","+691","+230","+262","+212","+258","+95","+264",
        "+977","+31","+64","+505","+227","+234","+850","+47","+968","+92",
        "+680","+507","+675","+595","+51","+63","+48","+351","+974","+40",
        "+7","+250","+290","+966","+221","+381","+232","+65","+421","+386",
        "+252","+27","+34","+94","+249","+597","+268","+46","+963","+886",
        "+255","+66","+228","+676","+216","+90","+993","+1681","+256","+380",
        "+971","+44","+598","+998","+84","+967","+260","+263",
    ].sort((a, b) => b.length - a.length);

    const digits = value.slice(1); // strip leading +
    const matchedCode = dialCodes.find((dc) => digits.startsWith(dc.slice(1)));
    const national = matchedCode
        ? digits.slice(matchedCode.length - 1)
        : digits;

    if (
        national.length < 10 ||
        national.length > 12
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